import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FieldMapping, Pipeline } from '../../../src/config/types.js';
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

describe('TransformEngine', () => {
  let store: StagingStore;
  const engine = new TransformEngine();

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
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

  it('type: string with cleanse trim|titleCase and max', async () => {
    await seed([{ CUST_NAME: '  alice smith  ' }]);
    const config = pipeline([
      { from: 'CUST_NAME', to: 'Name', type: 'string', cleanse: 'trim|titleCase', max: 5, optional: false },
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Name: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.Name).toBe('Alice');
  });

  it('type: number rounds and rejects NaN', async () => {
    await seed([{ QTY: '3.7' }, { QTY: 'not-a-number' }]);
    const config = pipeline([{ from: 'QTY', to: 'Quantity', type: 'number', optional: false }]);
    // onError: continue — bad row should be skipped
    const result = await engine.run(config, store);
    expect(result.rowsFailed).toBe(1);
    const out = await store.query<{ Quantity: unknown }>('SELECT * FROM stg_transformed');
    expect(Number(out[0]!.Quantity)).toBe(4);
  });

  it('type: decimal uses precision (default 2)', async () => {
    await seed([{ V: '3.14159' }]);
    const config = pipeline([
      { from: 'V', to: 'V', type: 'decimal', precision: 3, optional: false },
    ]);
    await engine.run(config, store);
    const out = await store.query<{ V: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.V).toBe('3.142');
  });

  it('type: boolean handles all truthy/falsy variants', async () => {
    await seed([
      { X: '1' },
      { X: 'true' },
      { X: 'yes' },
      { X: 'y' },
      { X: 't' },
      { X: 'TRUE' },
      { X: '0' },
      { X: 'no' },
      { X: 'whatever' },
    ]);
    const config = pipeline([{ from: 'X', to: 'B', type: 'boolean', optional: false }]);
    await engine.run(config, store);
    const out = await store.query<{ B: string }>('SELECT * FROM stg_transformed');
    expect(out.map((r) => r.B)).toEqual([
      'true',
      'true',
      'true',
      'true',
      'true',
      'true',
      'false',
      'false',
      'false',
    ]);
  });

  it('type: date parses with DD/MM/YYYY and emits target.dateFormat', async () => {
    await seed([{ D: '15/04/2026' }]);
    const config = pipeline(
      [{ from: 'D', to: 'D', type: 'date', format: 'DD/MM/YYYY', optional: false }],
      { target: { ...pipeline([]).target, dateFormat: 'YYYY-MM-DD' } },
    );
    await engine.run(config, store);
    const out = await store.query<{ D: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.D).toBe('2026-04-15');
  });

  it('type: concat joins `from` array with separator', async () => {
    await seed([{ A: '10 High St', B: 'Flat 2' }]);
    const config = pipeline([
      {
        from: ['A', 'B'],
        to: 'Address',
        type: 'concat',
        separator: ', ',
        cleanse: 'trim',
        optional: false,
      },
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Address: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.Address).toBe('10 High St, Flat 2');
  });

  it('type: constant emits its value for every row', async () => {
    await seed([{ X: '1' }, { X: '2' }]);
    const config = pipeline([
      { to: 'Group', type: 'constant', value: 'DOMESTIC', optional: false },
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Group: string }>('SELECT * FROM stg_transformed');
    expect(out.map((r) => r.Group)).toEqual(['DOMESTIC', 'DOMESTIC']);
  });

  it('type: expression — expr-eval path', async () => {
    await seed([{ X: '5' }]);
    const config = pipeline([
      {
        to: 'Double',
        type: 'expression',
        value: 'row.X * 2',
        optional: false,
      },
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Double: unknown }>('SELECT * FROM stg_transformed');
    // expr-eval returns number; stored as VARCHAR → '10' or '10.0'
    expect(String(out[0]!.Double)).toBe('10');
  });

  it('type: expression — js: path', async () => {
    await seed([{ NAME: 'alice' }]);
    const config = pipeline([
      {
        to: 'Upper',
        type: 'expression',
        value: 'js: row.NAME.toUpperCase()',
        optional: false,
      },
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Upper: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.Upper).toBe('ALICE');
  });

  it('type: lookup with default on miss', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sluice-lookup-'));
    try {
      const lookupCsv = join(tmp, 'currencies.csv');
      writeFileSync(lookupCsv, 'legacyCode,isoCode\nUSD,USD\nEUR,EUR\n', 'utf8');
      await seed([{ CUR: 'USD' }, { CUR: 'XYZ' }]);

      const config = pipeline([
        {
          from: 'CUR',
          to: 'CurrencyCode',
          type: 'lookup',
          lookup: 'currencyMap',
          default: 'GBP',
          optional: false,
        },
      ]);
      config.transform.lookups = [
        {
          name: 'currencyMap',
          source: {
            adapter: 'csv',
            file: lookupCsv,
            delimiter: ',',
            encoding: 'utf-8',
          },
          key: 'legacyCode',
          value: 'isoCode',
        },
      ];

      await engine.run(config, store);
      const out = await store.query<{ CurrencyCode: string }>(
        'SELECT * FROM stg_transformed ORDER BY CurrencyCode',
      );
      expect(out.map((r) => r.CurrencyCode).sort()).toEqual(['GBP', 'USD']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('type: lookup miss with optional: true → null', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sluice-lookup-'));
    try {
      const lookupCsv = join(tmp, 'vendors.csv');
      writeFileSync(lookupCsv, 'legacyVendorCode,bcVendorNo\nV1,NEW1\n', 'utf8');
      await seed([{ V: 'MISSING' }]);

      const config = pipeline([
        { from: 'V', to: 'VendorNo', type: 'lookup', lookup: 'vendorMap', optional: true },
      ]);
      config.transform.lookups = [
        {
          name: 'vendorMap',
          source: { adapter: 'csv', file: lookupCsv, delimiter: ',', encoding: 'utf-8' },
          key: 'legacyVendorCode',
          value: 'bcVendorNo',
        },
      ];
      await engine.run(config, store);
      const out = await store.query<{ VendorNo: string | null }>(
        'SELECT * FROM stg_transformed',
      );
      expect(out[0]!.VendorNo).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('type: lookup miss with optional: false and no default → throws TransformError', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sluice-lookup-'));
    try {
      const lookupCsv = join(tmp, 'divisions.csv');
      writeFileSync(lookupCsv, 'legacyCode,bcCode\nW,WOMENS\n', 'utf8');
      await seed([{ D: 'NOT_LISTED' }]);

      const config = pipeline(
        [{ from: 'D', to: 'Division', type: 'lookup', lookup: 'divMap', optional: false }],
        { run: { ...pipeline([]).run, onError: 'stop' } },
      );
      config.transform.lookups = [
        {
          name: 'divMap',
          source: { adapter: 'csv', file: lookupCsv, delimiter: ',', encoding: 'utf-8' },
          key: 'legacyCode',
          value: 'bcCode',
        },
      ];
      await expect(engine.run(config, store)).rejects.toBeInstanceOf(TransformError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('unmapped: true emits the default placeholder for every row, ignoring from/type', async () => {
    await seed([{ X: '1' }, { X: '2' }]);
    const config = pipeline([
      { to: 'Division', type: 'string', unmapped: true, optional: false },
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Division: string }>('SELECT * FROM stg_transformed');
    expect(out.map((r) => r.Division)).toEqual(['*** TBC ***', '*** TBC ***']);
  });

  it('unmapped: true honours a custom unmappedPlaceholder', async () => {
    await seed([{ X: '1' }]);
    const config = pipeline([
      { to: 'Division', type: 'string', unmapped: true, optional: false },
    ]);
    config.transform.unmappedPlaceholder = '<UNMAPPED>';
    await engine.run(config, store);
    const out = await store.query<{ Division: string }>('SELECT * FROM stg_transformed');
    expect(out[0]!.Division).toBe('<UNMAPPED>');
  });

  it('unmapped: true bypasses cleanse, max, and lookup', async () => {
    await seed([{ X: '1' }]);
    const config = pipeline([
      {
        to: 'Division',
        type: 'string',
        unmapped: true,
        cleanse: 'uppercase',
        max: 3,
        optional: false,
      },
    ]);
    await engine.run(config, store);
    const out = await store.query<{ Division: string }>('SELECT * FROM stg_transformed');
    // Placeholder is emitted verbatim — no cleanse, no truncation.
    expect(out[0]!.Division).toBe('*** TBC ***');
  });

  it('honours custom sourceTable and targetTable (Phase 3 prep Change 4)', async () => {
    await store.createTable('stg_merged', [{ name: 'X', duckDbType: 'VARCHAR' }]);
    await store.insertBatch('stg_merged', [{ X: 'hello' }]);

    const config = pipeline([
      { from: 'X', to: 'Y', type: 'string', cleanse: 'uppercase', optional: false },
    ]);
    const result = await engine.run(config, store, 'stg_merged', 'stg_final');
    expect(result.rowsIn).toBe(1);
    expect(result.rowsOut).toBe(1);
    expect(await store.tableExists('stg_final')).toBe(true);
    expect(await store.tableExists('stg_transformed')).toBe(false);
    const out = await store.query<{ Y: string }>('SELECT * FROM stg_final');
    expect(out[0]!.Y).toBe('HELLO');
  });
});
