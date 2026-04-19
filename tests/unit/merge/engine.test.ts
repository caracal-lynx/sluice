import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MergeConfig } from '../../../src/config/types.js';
import { MergeEngine } from '../../../src/merge/index.js';
import type { MergeSourceMeta } from '../../../src/merge/index.js';
import { StagingStore } from '../../../src/staging/index.js';

function makeConfig(overrides: Partial<MergeConfig> = {}): MergeConfig {
  return {
    key: 'STYLE_NO',
    strategy: 'coalesce',
    onUnmatched: 'include',
    fieldStrategies: [],
    ...overrides,
  };
}

describe('MergeEngine', () => {
  let store: StagingStore;
  let engine: MergeEngine;
  let tmpDir: string;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    engine = new MergeEngine();
    tmpDir = mkdtempSync(join(tmpdir(), 'sluice-merge-'));

    await store.createTable('stg_raw_sql', [
      { name: 'STYLE_NO', duckDbType: 'VARCHAR' },
      { name: 'COST_PRICE', duckDbType: 'VARCHAR' },
      { name: 'STYLE_DESC', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('stg_raw_sql', [
      { STYLE_NO: 'A', COST_PRICE: '10.00', STYLE_DESC: null },
      { STYLE_NO: 'B', COST_PRICE: '20.00', STYLE_DESC: 'FromSQL' },
      { STYLE_NO: 'D', COST_PRICE: '40.00', STYLE_DESC: 'OnlySQL' },
    ]);

    await store.createTable('stg_raw_excel', [
      { name: 'STYLE_NO', duckDbType: 'VARCHAR' },
      { name: 'COST_PRICE', duckDbType: 'VARCHAR' },
      { name: 'STYLE_DESC', duckDbType: 'VARCHAR' },
      { name: 'FIBRE_CONTENT', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('stg_raw_excel', [
      { STYLE_NO: 'A', COST_PRICE: '11.00', STYLE_DESC: 'FromExcelA', FIBRE_CONTENT: 'Wool' },
      { STYLE_NO: 'B', COST_PRICE: null, STYLE_DESC: 'FromExcelB', FIBRE_CONTENT: null },
      { STYLE_NO: 'C', COST_PRICE: '30.00', STYLE_DESC: 'FromExcelC', FIBRE_CONTENT: 'Cotton' },
    ]);
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function sources(): MergeSourceMeta[] {
    return [
      { id: 'sql', priority: 1, tableName: 'stg_raw_sql' },
      { id: 'excel', priority: 2, tableName: 'stg_raw_excel' },
    ];
  }

  it('coalesce strategy builds stg_merged with priority-aware fallbacks', async () => {
    const result = await engine.run(
      store,
      sources(),
      makeConfig({
        strategy: 'coalesce',
        fieldStrategies: [{ field: 'FIBRE_CONTENT', source: 'excel' }],
      }),
    );

    expect(result.tableName).toBe('stg_merged');
    expect(result.rowsMerged).toBe(4);
    expect(result.unmatched).toBe(2); // C and D
    expect(result.conflicts).toBe(2); // A:COST_PRICE and B:STYLE_DESC

    const rows = await store.query<Array<Record<string, unknown>>>(
      'SELECT STYLE_NO, COST_PRICE, STYLE_DESC, FIBRE_CONTENT FROM stg_merged ORDER BY STYLE_NO',
    );

    expect(rows).toEqual([
      { STYLE_NO: 'A', COST_PRICE: '10.00', STYLE_DESC: 'FromExcelA', FIBRE_CONTENT: 'Wool' },
      { STYLE_NO: 'B', COST_PRICE: '20.00', STYLE_DESC: 'FromSQL', FIBRE_CONTENT: null },
      { STYLE_NO: 'C', COST_PRICE: '30.00', STYLE_DESC: 'FromExcelC', FIBRE_CONTENT: 'Cotton' },
      { STYLE_NO: 'D', COST_PRICE: '40.00', STYLE_DESC: 'OnlySQL', FIBRE_CONTENT: null },
    ]);
  });

  it('priority-override keeps top-priority value even when lower source has a value', async () => {
    await store.query("UPDATE stg_raw_sql SET STYLE_DESC = NULL WHERE STYLE_NO = 'B'");

    await engine.run(
      store,
      sources(),
      makeConfig({ strategy: 'priority-override' }),
    );

    const rows = await store.query<{ STYLE_DESC: string | null }[]>(
      "SELECT STYLE_DESC FROM stg_merged WHERE STYLE_NO = 'B'",
    );
    expect(rows[0]!.STYLE_DESC).toBeNull();
  });

  it('onUnmatched=exclude removes records present in only one source', async () => {
    const result = await engine.run(
      store,
      sources(),
      makeConfig({ onUnmatched: 'exclude' }),
    );

    expect(result.unmatched).toBe(2);
    expect(result.rowsMerged).toBe(2);

    const ids = await store.query<{ STYLE_NO: string }>('SELECT STYLE_NO FROM stg_merged ORDER BY STYLE_NO');
    expect(ids.map((r) => r.STYLE_NO)).toEqual(['A', 'B']);
  });

  it('strategy=intersect keeps only records present in all sources', async () => {
    const result = await engine.run(
      store,
      sources(),
      makeConfig({ strategy: 'intersect' }),
    );

    expect(result.rowsMerged).toBe(2);
    const ids = await store.query<{ STYLE_NO: string }>('SELECT STYLE_NO FROM stg_merged ORDER BY STYLE_NO');
    expect(ids.map((r) => r.STYLE_NO)).toEqual(['A', 'B']);
  });

  it('onUnmatched=error throws when unmatched rows exist', async () => {
    await expect(
      engine.run(store, sources(), makeConfig({ onUnmatched: 'error' })),
    ).rejects.toThrow(/unmatched row\(s\)/i);
  });

  it('writes conflict CSV when conflictLog path is configured', async () => {
    const conflictPath = join(tmpDir, 'conflicts.csv');
    const result = await engine.run(
      store,
      sources(),
      makeConfig({ conflictLog: conflictPath }),
    );

    expect(result.conflicts).toBeGreaterThan(0);

    const contents = readFileSync(conflictPath, 'utf-8');
    expect(contents).toContain('field,winning_source,winning_value,source_values');
    expect(contents).toContain('COST_PRICE');
    expect(contents).toContain('STYLE_DESC');
  });
});
