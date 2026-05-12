import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FieldMapping, Pipeline } from '../../../src/config/types.js';
import type { CustomFieldMapping } from '../../../src/plugins/types.js';
import { TransformRegistry } from '../../../src/plugins/registry.js';
import { StagingStore } from '../../../src/staging/index.js';
import { TransformEngine } from '../../../src/transform/engine.js';
import { TransformError } from '../../../src/utils/errors.js';

function pipeline(
  fields: FieldMapping[],
  overrides: Partial<Pipeline> = {},
): Pipeline {
  return {
    pipeline: { name: 'tx-test', client: 't', version: '1.0', entity: 'T' },
    source: { adapter: 'csv', file: 'unused', delimiter: ',', encoding: 'utf-8' },
    dq: { stopOnCritical: false, rules: [] },
    transform: { lookups: [], fields, unmappedPlaceholder: '*** TBC ***' },
    target: {
      adapter: 'csv',
      delimiter: ',',
      encoding: 'utf-8',
      nullValue: '',
      apiVersion: 'v2.0',
      onConflict: 'fail',
      batchEndpoint: true,
      schema: 'public',
    },
    run: {
      mode: 'full',
      batchSize: 500,
      onError: 'continue',
      logLevel: 'info',
      dryRun: false,
      outputDir: './output',
      stagingDb: '',
    },
    ...overrides,
  } as Pipeline;
}

describe('TransformEngine — custom operations (type: custom)', () => {
  let store: StagingStore;
  let registry: TransformRegistry;
  let engine: TransformEngine;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    registry = new TransformRegistry();
    engine = new TransformEngine(registry);
  });

  afterEach(async () => {
    await store.close();
  });

  async function seed(rows: Record<string, unknown>[]): Promise<void> {
    const firstRow = rows[0];
    if (!firstRow) return;
    await store.createTable(
      'stg_raw',
      Object.keys(firstRow).map((n) => ({ name: n, duckDbType: 'VARCHAR' })),
    );
    await store.insertBatch('stg_raw', rows);
  }

  it('invokes a registered custom transform plugin', async () => {
    // Register a simple doubler plugin
    registry.register({
      id: 'doubler',
      apply: (value: unknown) => {
        if (value === null || value === undefined) return null;
        const n = Number(value);
        return isNaN(n) ? null : String(n * 2);
      },
    });

    await seed([{ X: '21' }]);
    const config = pipeline([
      {
        from: 'X',
        to: 'Result',
        type: 'custom',
        customOp: 'doubler',
        optional: false,
      } as FieldMapping,
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Result: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.Result).toBe('42');
  });

  it('passes options through to the plugin', async () => {
    // Register a plugin that uses options.multiplier
    registry.register({
      id: 'multiply',
      apply: (value: unknown, _row: unknown, config: CustomFieldMapping) => {
        if (value === null || value === undefined) return null;
        const multiplier = (config.options?.['multiplier'] as number | undefined) ?? 1;
        const n = Number(value);
        return isNaN(n) ? null : String(n * multiplier);
      },
    });

    await seed([{ X: '10' }]);
    const config = pipeline([
      {
        from: 'X',
        to: 'Result',
        type: 'custom',
        customOp: 'multiply',
        options: { multiplier: 5 },
        optional: false,
      } as FieldMapping,
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Result: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.Result).toBe('50');
  });

  it('provides access to the full row in the plugin', async () => {
    // Register a plugin that concatenates current field with another row field
    registry.register({
      id: 'concatWithRow',
      apply: (value: unknown, row: Record<string, unknown>, config: CustomFieldMapping) => {
        if (value === null || value === undefined) return null;
        const otherField = (config.options?.['otherField'] as string | undefined) ?? 'id';
        const otherValue = row[otherField];
        if (otherValue === null || otherValue === undefined) return String(value);
        const prefix = (config.options?.['prefix'] as string | undefined) ?? '';
        return `${prefix}${String(value)}_${String(otherValue)}`;
      },
    });

    await seed([{ name: 'alice', id: '123' }]);
    const config = pipeline([
      {
        from: 'name',
        to: 'Result',
        type: 'custom',
        customOp: 'concatWithRow',
        options: { otherField: 'id', prefix: 'ID_' },
        optional: false,
      } as FieldMapping,
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Result: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.Result).toBe('ID_alice_123');
  });

  it('handles null return from plugin per optional flag', async () => {
    registry.register({
      id: 'alwaysNull',
      apply: () => null,
    });

    await seed([{ X: 'data' }]);

    // With optional: true, null is acceptable
    const config1 = pipeline([
      {
        from: 'X',
        to: 'R1',
        type: 'custom',
        customOp: 'alwaysNull',
        optional: true,
      } as FieldMapping,
    ]);
    await engine.run(config1, store);
    const out1 = await store.query<{ R1: string | null }>('SELECT * FROM stg_transformed');
    expect(out1[0]!.R1).toBeNull();
  });

  it('throws TransformError when unknown customOp is referenced', async () => {
    await seed([{ X: 'data' }]);
    const config = pipeline(
      [
        {
          from: 'X',
          to: 'Result',
          type: 'custom',
          customOp: 'unknownPlugin',
          optional: false,
        } as FieldMapping,
      ],
      { run: { ...pipeline([]).run, onError: 'stop' } },
    );
    await expect(engine.run(config, store)).rejects.toBeInstanceOf(TransformError);
  });

  it('throws TransformError when customOp is missing', async () => {
    await seed([{ X: 'data' }]);
    const config = pipeline(
      [
        {
          from: 'X',
          to: 'Result',
          type: 'custom',
          optional: false,
        } as FieldMapping,
      ],
      { run: { ...pipeline([]).run, onError: 'stop' } },
    );
    await expect(engine.run(config, store)).rejects.toBeInstanceOf(TransformError);
  });

  it('continues on error when onError: continue', async () => {
    registry.register({
      id: 'failingPlugin',
      apply: () => {
        throw new Error('Plugin failed');
      },
    });

    await seed([{ X: 'a' }, { X: 'b' }]);
    const config = pipeline(
      [
        {
          from: 'X',
          to: 'Result',
          type: 'custom',
          customOp: 'failingPlugin',
          optional: false,
        } as FieldMapping,
      ],
      { run: { ...pipeline([]).run, onError: 'continue' } },
    );
    const result = await engine.run(config, store);
    expect(result.rowsFailed).toBe(2);
  });

  it('handles multiple custom fields in same pipeline', async () => {
    registry.register({
      id: 'double',
      apply: (v: unknown) => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : String(n * 2);
      },
    });
    registry.register({
      id: 'triple',
      apply: (v: unknown) => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : String(n * 3);
      },
    });

    await seed([{ X: '10', Y: '5' }]);
    const config = pipeline([
      {
        from: 'X',
        to: 'Doubled',
        type: 'custom',
        customOp: 'double',
        optional: false,
      } as FieldMapping,
      {
        from: 'Y',
        to: 'Tripled',
        type: 'custom',
        customOp: 'triple',
        optional: false,
      } as FieldMapping,
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Doubled: string; Tripled: string }>(
      'SELECT * FROM stg_transformed',
    );
    expect(out[0]!.Doubled).toBe('20');
    expect(out[0]!.Tripled).toBe('15');
  });

  it('mixes custom fields with other field types in same pipeline', async () => {
    registry.register({
      id: 'uppercase',
      apply: (v: unknown) => {
        if (v === null || v === undefined) return null;
        return String(v).toUpperCase();
      },
    });

    await seed([{ name: 'alice', qty: '42' }]);
    const config = pipeline([
      { from: 'name', to: 'Name', type: 'string', cleanse: 'trim', optional: false },
      {
        from: 'name',
        to: 'NameUpper',
        type: 'custom',
        customOp: 'uppercase',
        optional: false,
      } as FieldMapping,
      { from: 'qty', to: 'Qty', type: 'number', optional: false },
      { to: 'Group', type: 'constant', value: 'TEST', optional: false },
    ]);
    await engine.run(config, store);
    const out = await store.query<{
      Name: string;
      NameUpper: string;
      Qty: string;
      Group: string;
    }>('SELECT * FROM stg_transformed');
    expect(out[0]).toEqual({
      Name: 'alice',
      NameUpper: 'ALICE',
      Qty: '42',
      Group: 'TEST',
    });
  });

  it('respects null/undefined from source field before calling plugin', async () => {
    registry.register({
      id: 'testOp',
      apply: (v: unknown) => {
        // Plugin converts any null to 'WAS_NULL', others to uppercase
        if (v === null || v === undefined) return 'WAS_NULL';
        return String(v).toUpperCase();
      },
    });

    await seed([{ X: '' }, { X: 'value' }]);
    const config = pipeline([
      {
        from: 'X',
        to: 'Result',
        type: 'custom',
        customOp: 'testOp',
        optional: true, // With optional: true, empty string input → null from engine
      } as FieldMapping,
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Result: string | null }>('SELECT * FROM stg_transformed');
    // Empty string with optional:true should return null before calling plugin
    expect(out[0]!.Result).toBeNull();
    expect(out[1]!.Result).toBe('VALUE');
  });

  it('applies default value when plugin returns null and default is set', async () => {
    registry.register({
      id: 'maybeNull',
      apply: (v: unknown) => (v === 'trigger' ? null : v),
    });

    await seed([{ X: 'trigger' }, { X: 'keep' }]);
    const config = pipeline([
      {
        from: 'X',
        to: 'Result',
        type: 'custom',
        customOp: 'maybeNull',
        default: 'DEFAULT',
        optional: false,
      } as FieldMapping,
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Result: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.Result).toBe('DEFAULT');
    expect(out[1]!.Result).toBe('keep');
  });
});
