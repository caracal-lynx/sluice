import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Pipeline } from '../../../src/config/types.js';
import { DQEngine } from '../../../src/dq/engine.js';
import { StagingStore } from '../../../src/staging/index.js';

// Construct a runnable Pipeline object for the engine. We bypass YAML to keep
// these tests focused on engine behaviour.
function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    pipeline: {
      name: 'test-dq',
      client: 'test',
      version: '1.0',
      entity: 'Test',
    },
    source: { adapter: 'csv', file: 'unused', delimiter: ',', encoding: 'utf-8' },
    dq: {
      stopOnCritical: true,
      rules: [],
    },
    transform: { lookups: [], fields: [{ to: 'x', type: 'constant', value: 'y', optional: false }] },
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

describe('DQEngine', () => {
  let store: StagingStore;
  let tmp: string;
  const engine = new DQEngine();

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    tmp = mkdtempSync(join(tmpdir(), 'sluice-dq-'));

    await store.createTable('stg_raw', [
      { name: 'CUST_CODE', duckDbType: 'VARCHAR' },
      { name: 'CUST_NAME', duckDbType: 'VARCHAR' },
      { name: 'EMAIL', duckDbType: 'VARCHAR' },
      { name: 'POST_CODE', duckDbType: 'VARCHAR' },
      { name: 'COUNTRY', duckDbType: 'VARCHAR' },
      { name: 'CREDIT_LIMIT', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('stg_raw', [
      // 0: clean
      { CUST_CODE: 'A001', CUST_NAME: 'Alice', EMAIL: 'a@x.com', POST_CODE: 'SW1A 1AA', COUNTRY: 'GB', CREDIT_LIMIT: '100' },
      // 1: duplicate code, bad email, good postcode
      { CUST_CODE: 'A001', CUST_NAME: 'Bob', EMAIL: 'bad-email', POST_CODE: 'EH3 8EQ', COUNTRY: 'GB', CREDIT_LIMIT: '50' },
      // 2: null name, bad postcode, bad country
      { CUST_CODE: 'A002', CUST_NAME: null, EMAIL: 'b@x.com', POST_CODE: 'nonsense', COUNTRY: 'zz', CREDIT_LIMIT: '-10' },
    ]);
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('produces a zero-violation summary when no rules are configured', async () => {
    const config = makePipeline({
      dq: { stopOnCritical: false, rules: [] },
      run: { ...makePipeline().run, outputDir: tmp },
    });
    const summary = await engine.run(config, store);
    expect(summary.rowsChecked).toBe(3);
    expect(summary.rowsPassed).toBe(3);
    expect(summary.rowsRejected).toBe(0);
    expect(summary.violations.critical).toBe(0);
    expect(summary.reportPath).toContain('test-dq-dq-summary.json');
  });

  it('detects notNull, unique, email, ukPostcode, allowedValues, min violations', async () => {
    const config = makePipeline({
      dq: {
        stopOnCritical: false,
        rules: [
          {
            field: 'CUST_CODE',
            checks: [
              { type: 'notNull', severity: 'critical' },
              { type: 'unique', severity: 'critical' },
            ],
          },
          {
            field: 'CUST_NAME',
            checks: [{ type: 'notNull', severity: 'critical' }],
          },
          {
            field: 'EMAIL',
            checks: [{ type: 'email', severity: 'warning' }],
          },
          {
            field: 'POST_CODE',
            checks: [{ type: 'ukPostcode', severity: 'warning' }],
          },
          {
            field: 'COUNTRY',
            checks: [{ type: 'allowedValues', value: ['GB', 'IE'], severity: 'warning' }],
          },
          {
            field: 'CREDIT_LIMIT',
            checks: [{ type: 'min', value: 0, severity: 'critical' }],
          },
        ],
      },
      run: { ...makePipeline().run, outputDir: tmp },
    });
    const summary = await engine.run(config, store);

    // Rows 0 and 1 share CUST_CODE='A001' → two 'unique' critical violations
    // Row 2 has CUST_NAME null → 1 'notNull' critical
    // Row 2 has CREDIT_LIMIT -10 → 1 'min' critical
    expect(summary.violations.critical).toBeGreaterThanOrEqual(4);
    // Row 1 bad-email + Row 2 bad POST_CODE + Row 2 bad COUNTRY → 3 warnings at least
    expect(summary.violations.warning).toBeGreaterThanOrEqual(3);

    // Critical rows: {0, 1} (unique) ∪ {2} (notNull, min) = {0, 1, 2}
    expect(summary.rowsRejected).toBe(3);
    expect(summary.rowsPassed).toBe(0);

    // byField sanity
    expect(summary.byField['CUST_CODE']!.critical).toBe(2);
    expect(summary.byField['EMAIL']!.warning).toBe(1);

    // Files written
    const summaryJson = JSON.parse(readFileSync(summary.reportPath, 'utf-8'));
    expect(summaryJson.pipeline).toBe('test-dq');
    expect(summaryJson.rejectedRowIndices).toBeUndefined(); // stripped from disk

    const rejectedCsv = readFileSync(join(tmp, 'test-dq-rejected.csv'), 'utf-8');
    expect(rejectedCsv).toContain('row_index,field,value,rule,severity,message');
    expect(rejectedCsv).toContain('unique');
    expect(rejectedCsv).toContain('email');
  });

  it('honours a custom tableName (Phase 3 prep Change 3)', async () => {
    // Create a second table with a single unique-ok row
    await store.createTable('stg_merged', [
      { name: 'CUST_CODE', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('stg_merged', [{ CUST_CODE: 'X' }]);

    const config = makePipeline({
      dq: {
        stopOnCritical: false,
        rules: [
          {
            field: 'CUST_CODE',
            checks: [
              { type: 'notNull', severity: 'critical' },
              { type: 'unique', severity: 'critical' },
            ],
          },
        ],
      },
      run: { ...makePipeline().run, outputDir: tmp },
    });
    const summary = await engine.run(config, store, 'stg_merged');
    expect(summary.rowsChecked).toBe(1);
    expect(summary.violations.critical).toBe(0);
  });

  it('accepts and ignores `sourceId` on DQ rules (Phase 1 behaviour)', async () => {
    const config = makePipeline({
      dq: {
        stopOnCritical: false,
        rules: [
          {
            field: 'CUST_CODE',
            // @ts-expect-error — sourceId lives on the inferred type after Change 2
            sourceId: 'sql-server',
            checks: [{ type: 'notNull', severity: 'critical' }],
          },
        ],
      },
      run: { ...makePipeline().run, outputDir: tmp },
    });
    const summary = await engine.run(config, store);
    // Phase 1 should still evaluate every rule (sourceId ignored).
    expect(summary.rowsChecked).toBe(3);
  });
});
