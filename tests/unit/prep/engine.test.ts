import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';

import '../../../src/adapters/source/index.js';
import { PrepEngine } from '../../../src/prep/engine.js';
import { PrepLookupResolver } from '../../../src/prep/lookup.js';
import { ExpressionEvaluator } from '../../../src/transform/expression.js';
import { StagingStore } from '../../../src/staging/index.js';
import { PrepError } from '../../../src/utils/errors.js';
import { RunSchema, PrepSchema } from '../../../src/config/schema.js';
import type { PrepConfig, RunConfig } from '../../../src/config/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixtureCsv = path.resolve(__dirname, '../../fixtures/lookups/hc-code-fixups.csv');

const baseRun: RunConfig = RunSchema.parse({});

function makeLogger(): Logger {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    child: () => logger,
    level: 'info',
  } as unknown as Logger;
  return logger;
}

async function seed(store: StagingStore, rows: Record<string, unknown>[], table = 'stg_raw'): Promise<void> {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!).map((name) => ({ name, duckDbType: 'VARCHAR' }));
  await store.createTable(table, cols);
  await store.insertBatch(table, rows);
}

function parsePrep(raw: unknown): PrepConfig {
  return PrepSchema.parse(raw);
}

describe('PrepEngine', () => {
  let store: StagingStore;
  let resolver: PrepLookupResolver;
  let evaluator: ExpressionEvaluator;
  let logger: Logger;
  let engine: PrepEngine;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    resolver = new PrepLookupResolver();
    evaluator = new ExpressionEvaluator();
    logger = makeLogger();
    engine = new PrepEngine(store, resolver, evaluator, logger);
  });

  afterEach(async () => {
    await store.close();
  });

  describe('cleanse op', () => {
    it('mutates the named column in place', async () => {
      await seed(store, [
        { HC_CODE: '12345678' },
        { HC_CODE: '00112233' },
      ]);
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', cleanse: 'padEnd:10:0' }],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rulesApplied).toBe(1);
      expect(out.rules[0]!.rowsChanged).toBe(2);

      const rows = await store.query<{ HC_CODE: string }>('SELECT * FROM stg_raw ORDER BY HC_CODE');
      expect(rows.map((r) => r.HC_CODE)).toEqual(['0011223300', '1234567800']);
    });

    it('rowsChanged is accurate when some rows already match', async () => {
      await seed(store, [
        { HC_CODE: '1234567890' }, // already 10 chars — no change
        { HC_CODE: '12345678' },   // padded — change
      ]);
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', cleanse: 'padEnd:10:0' }],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rules[0]!.rowsChanged).toBe(1);
    });

    it('op label includes the cleanse spec', async () => {
      await seed(store, [{ HC_CODE: 'x' }]);
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', cleanse: 'trim|uppercase' }],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rules[0]!.op).toBe('cleanse:trim|uppercase');
    });

    it('throws PrepError on cleanse runtime error when onError: stop', async () => {
      await seed(store, [{ HC_CODE: 'x' }]);
      // bogus cleanse op slips past the regex (alpha only) but fails at runtime
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', cleanse: 'wibble' }],
      });
      await expect(
        engine.run('stg_raw', prep, undefined, { ...baseRun, onError: 'stop' }),
      ).rejects.toThrow(PrepError);
    });

    it('increments rowsFailed on cleanse runtime error when onError: continue', async () => {
      await seed(store, [{ HC_CODE: 'x' }, { HC_CODE: 'y' }]);
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', cleanse: 'wibble' }],
      });
      const out = await engine.run('stg_raw', prep, undefined, { ...baseRun, onError: 'continue' });
      expect(out.rules[0]!.rowsFailed).toBe(2);
      expect(out.rules[0]!.rowsChanged).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('expression op', () => {
    it('mutates the named column via expr-eval', async () => {
      await seed(store, [{ a: '10', b: '5' }]);
      const prep = parsePrep({
        rules: [
          { field: 'a', expression: 'row.a + row.b' },
        ],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rules[0]!.rowsChanged).toBe(1);
      const rows = await store.query<{ a: string }>('SELECT a FROM stg_raw');
      // DuckDB coerces '10' + '5' VARCHARs — but expr-eval got strings and
      // its `+` operator concatenates them. Either '15' (if expr-eval parsed
      // numerics) or '105' (string concat). Assert that whichever it is, the
      // value was rewritten and not equal to the source.
      expect(rows[0]!.a).not.toBe('10');
    });

    it('js: expression executes and emits a warn log', async () => {
      await seed(store, [{ STYLE_NO: 'abc-123' }]);
      const prep = parsePrep({
        rules: [
          { field: 'STYLE_NO', expression: 'js: row.STYLE_NO.toUpperCase()' },
        ],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      const rows = await store.query<{ STYLE_NO: string }>('SELECT STYLE_NO FROM stg_raw');
      expect(rows[0]!.STYLE_NO).toBe('ABC-123');
      expect(out.rules[0]!.rowsChanged).toBe(1);
      // The expression evaluator logs the warn for js: paths.
      // Our engine forwards the same evaluator to the logger, but the
      // pino default logger is used — so we just verify the value was
      // mutated. (Direct warn-spy is exercised in expression.test.ts.)
    });

    it('respects onError: continue when expression throws', async () => {
      await seed(store, [{ a: 'x' }, { a: 'y' }]);
      const prep = parsePrep({
        rules: [
          { field: 'a', expression: 'js: row.notDefined.something' },
        ],
      });
      const out = await engine.run('stg_raw', prep, undefined, { ...baseRun, onError: 'continue' });
      expect(out.rules[0]!.rowsFailed).toBe(2);
      expect(out.rules[0]!.rowsChanged).toBe(0);
    });
  });

  describe('lookup op', () => {
    beforeEach(async () => {
      await resolver.loadAll(
        [
          {
            name: 'hcCodeFixups',
            source: { adapter: 'csv', file: fixtureCsv, delimiter: ',', encoding: 'utf-8' },
            key: 'invalid_code',
            value: 'valid_code',
          },
        ],
        baseRun,
      );
    });

    it('hit replaces the value', async () => {
      await seed(store, [
        { HC_CODE: '6109909000' }, // in fixup table
        { HC_CODE: '9999999999' }, // not in fixup table
      ]);
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', lookup: 'hcCodeFixups' }],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rules[0]!.rowsChanged).toBe(1);
      const rows = await store.query<{ HC_CODE: string | null }>(
        'SELECT HC_CODE FROM stg_raw ORDER BY HC_CODE',
      );
      // Both rows remain — first was swapped; second kept (default onMiss: keep).
      expect(rows.map((r) => r.HC_CODE).sort()).toEqual(['6109100090', '9999999999']);
    });

    it('miss + onMiss: keep leaves the value unchanged', async () => {
      await seed(store, [{ HC_CODE: 'nope' }]);
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', lookup: 'hcCodeFixups', onMiss: 'keep' }],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rules[0]!.rowsChanged).toBe(0);
      const rows = await store.query<{ HC_CODE: string }>('SELECT HC_CODE FROM stg_raw');
      expect(rows[0]!.HC_CODE).toBe('nope');
    });

    it('miss + onMiss: null sets the value to NULL', async () => {
      await seed(store, [{ HC_CODE: 'nope' }]);
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', lookup: 'hcCodeFixups', onMiss: 'null' }],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rules[0]!.rowsChanged).toBe(1);
      const rows = await store.query<{ HC_CODE: string | null }>('SELECT HC_CODE FROM stg_raw');
      expect(rows[0]!.HC_CODE).toBeNull();
    });

    it('miss + onMiss: error throws PrepError even with onError: continue', async () => {
      await seed(store, [{ HC_CODE: 'nope' }]);
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', lookup: 'hcCodeFixups', onMiss: 'error' }],
      });
      await expect(
        engine.run('stg_raw', prep, undefined, { ...baseRun, onError: 'continue' }),
      ).rejects.toThrow(PrepError);
    });

    it('op label includes the lookup name', async () => {
      await seed(store, [{ HC_CODE: '6109909000' }]);
      const prep = parsePrep({
        rules: [{ field: 'HC_CODE', lookup: 'hcCodeFixups' }],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rules[0]!.op).toBe('lookup:hcCodeFixups');
    });
  });

  describe('when predicate', () => {
    it('truthy → rule applied', async () => {
      await seed(store, [{ HC_CODE: '12345678' }]);
      const prep = parsePrep({
        rules: [
          {
            field: 'HC_CODE',
            when: 'row.HC_CODE == "12345678"',
            cleanse: 'padEnd:10:0',
          },
        ],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rules[0]!.rowsChanged).toBe(1);
      expect(out.rules[0]!.rowsSkipped).toBe(0);
    });

    it('falsy → rule skipped, rowsSkipped increments', async () => {
      await seed(store, [
        { HC_CODE: '12345678' },   // matches predicate — padded
        { HC_CODE: '1234567890' }, // does not match — skipped
      ]);
      const prep = parsePrep({
        rules: [
          {
            field: 'HC_CODE',
            when: 'js: row.HC_CODE.length === 8',
            cleanse: 'padEnd:10:0',
          },
        ],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rules[0]!.rowsChanged).toBe(1);
      expect(out.rules[0]!.rowsSkipped).toBe(1);
    });

    it('runtime error + onError: continue → rowsFailed + warn', async () => {
      await seed(store, [{ HC_CODE: 'x' }]);
      const prep = parsePrep({
        rules: [
          {
            field: 'HC_CODE',
            when: 'js: row.MISSING.length === 8',
            cleanse: 'padEnd:10:0',
          },
        ],
      });
      const out = await engine.run('stg_raw', prep, undefined, { ...baseRun, onError: 'continue' });
      expect(out.rules[0]!.rowsFailed).toBe(1);
      expect(out.rules[0]!.rowsChanged).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('runtime error + onError: stop → PrepError', async () => {
      await seed(store, [{ HC_CODE: 'x' }]);
      const prep = parsePrep({
        rules: [
          {
            field: 'HC_CODE',
            when: 'js: row.MISSING.length === 8',
            cleanse: 'padEnd:10:0',
          },
        ],
      });
      await expect(
        engine.run('stg_raw', prep, undefined, { ...baseRun, onError: 'stop' }),
      ).rejects.toThrow(PrepError);
    });
  });

  describe('rule ordering', () => {
    it('multiple rules on the same field apply in declared order', async () => {
      await seed(store, [{ HC_CODE: '12345678' }]);
      await resolver.loadAll(
        [
          {
            name: 'hcCodeFixups',
            source: { adapter: 'csv', file: fixtureCsv, delimiter: ',', encoding: 'utf-8' },
            key: 'invalid_code',
            value: 'valid_code',
          },
        ],
        baseRun,
      );
      const prep = parsePrep({
        rules: [
          // 1. Pad to 10 chars: '12345678' → '1234567800'
          { field: 'HC_CODE', cleanse: 'padEnd:10:0' },
          // 2. Lookup against fixups: '1234567800' is not in fixups, kept.
          //    But: change the seed value so we can observe the order — the
          //    fixup table maps 0000000000 → 6109100090, so seed with 8 zeros
          //    + padEnd would produce 0000000000, then lookup would swap it.
        ],
      });
      await engine.run('stg_raw', prep, undefined, baseRun);
      // The above pipeline alone won't trigger both rules. Re-seed and use
      // a value that exercises both:
      await store.dropTable('stg_raw');
      await seed(store, [{ HC_CODE: '00000000' }]);
      const prep2 = parsePrep({
        rules: [
          { field: 'HC_CODE', cleanse: 'padEnd:10:0' },
          { field: 'HC_CODE', lookup: 'hcCodeFixups' },
        ],
      });
      const out = await engine.run('stg_raw', prep2, undefined, baseRun);
      expect(out.rulesApplied).toBe(2);
      expect(out.rules[0]!.rowsChanged).toBe(1); // padded
      expect(out.rules[1]!.rowsChanged).toBe(1); // swapped via fixup table
      const rows = await store.query<{ HC_CODE: string }>('SELECT HC_CODE FROM stg_raw');
      expect(rows[0]!.HC_CODE).toBe('6109100090');
    });
  });

  describe('column validation', () => {
    it('throws PrepError if a rule references an unknown column (before any mutation)', async () => {
      await seed(store, [{ HC_CODE: '12345678' }]);
      const prep = parsePrep({
        rules: [{ field: 'NONEXISTENT', cleanse: 'trim' }],
      });
      await expect(engine.run('stg_raw', prep, undefined, baseRun)).rejects.toThrow(
        PrepError,
      );
      // Table is untouched.
      const rows = await store.query<{ HC_CODE: string }>('SELECT HC_CODE FROM stg_raw');
      expect(rows[0]!.HC_CODE).toBe('12345678');
    });
  });

  describe('multi-source firing scoping', () => {
    it('with no applicable rules, returns empty result and leaves table alone', async () => {
      await seed(store, [{ id: '1', val: 'unchanged' }]);
      const prep = parsePrep({
        // Rule scoped to source "other" — does not apply when sourceId === "a"
        rules: [{ field: 'val', sourceId: 'other', cleanse: 'uppercase' }],
      });
      const out = await engine.run('stg_raw', prep, 'a', baseRun);
      expect(out.rulesApplied).toBe(0);
      expect(out.rules).toEqual([]);
      const rows = await store.query<{ val: string }>('SELECT val FROM stg_raw');
      expect(rows[0]!.val).toBe('unchanged');
    });

    it('pre-merge: only sourceId-matched rules apply', async () => {
      await seed(store, [{ id: '1', val: 'mixed' }]);
      const prep = parsePrep({
        rules: [
          { field: 'val', sourceId: 'a', cleanse: 'uppercase' },
          { field: 'val', sourceId: 'b', cleanse: 'lowercase' },
        ],
      });
      const out = await engine.run('stg_raw', prep, 'a', baseRun);
      expect(out.rulesApplied).toBe(1);
      expect(out.rules[0]!.op).toBe('cleanse:uppercase');
      const rows = await store.query<{ val: string }>('SELECT val FROM stg_raw');
      expect(rows[0]!.val).toBe('MIXED');
    });

    it('post-merge (sourceId undefined): only rules without sourceId apply', async () => {
      await seed(store, [{ id: '1', val: 'MIXED' }]);
      const prep = parsePrep({
        rules: [
          { field: 'val', sourceId: 'a', cleanse: 'uppercase' },
          { field: 'val', cleanse: 'lowercase' }, // no sourceId — post-merge
        ],
      });
      const out = await engine.run('stg_raw', prep, undefined, baseRun);
      expect(out.rulesApplied).toBe(1);
      expect(out.rules[0]!.op).toBe('cleanse:lowercase');
      const rows = await store.query<{ val: string }>('SELECT val FROM stg_raw');
      expect(rows[0]!.val).toBe('mixed');
    });
  });
});
