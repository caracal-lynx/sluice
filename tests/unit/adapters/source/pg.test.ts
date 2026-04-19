import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => {
  const clientRelease = vi.fn();
  const client = { release: clientRelease };
  const query = vi.fn().mockResolvedValue({
    rows: [{ id: 1, name: 'a' }],
    fields: [
      { name: 'id', dataTypeID: 23 },
      { name: 'name', dataTypeID: 1043 },
    ],
  });
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    end: vi.fn().mockResolvedValue(undefined),
    query,
  };
  const Pool = vi.fn(() => pool);
  return { default: { Pool, __pool: pool, __query: query } };
});

const pgModule = (await import('pg')) as unknown as {
  default: { __pool: { connect: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> }; __query: ReturnType<typeof vi.fn> };
};
const { PgSourceAdapter } = await import('../../../../src/adapters/source/pg.js');
const { StagingStore } = await import('../../../../src/staging/index.js');
const { SourceError } = await import('../../../../src/utils/errors.js');

import type { RunConfig, SourceConfig } from '../../../../src/config/types.js';

const BASE_RUN: RunConfig = {
  mode: 'full',
  batchSize: 500,
  onError: 'continue',
  logLevel: 'info',
  dryRun: false,
  outputDir: './output',
  stagingDb: '',
};

describe('PgSourceAdapter', () => {
  let store: InstanceType<typeof StagingStore>;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
  });

  afterEach(async () => {
    await store.close();
    vi.clearAllMocks();
  });

  it('extracts rows with DuckDB types inferred from pg OIDs', async () => {
    const adapter = new PgSourceAdapter();
    const config: SourceConfig = {
      adapter: 'pg',
      connection: 'postgres://u:p@h/d',
      query: 'SELECT id, name FROM t',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(1);
    expect(result.columns).toEqual([
      { name: 'id', duckDbType: 'BIGINT' },
      { name: 'name', duckDbType: 'VARCHAR' },
    ]);
    await adapter.disconnect();
    expect(pgModule.default.__pool.end).toHaveBeenCalled();
  });

  it('uses a custom targetTable (Phase 3 prep Change 1)', async () => {
    const adapter = new PgSourceAdapter();
    const config: SourceConfig = {
      adapter: 'pg',
      connection: 'postgres://u:p@h/d',
      query: 'SELECT 1',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {}, 'stg_raw_odoo');
    expect(result.tableName).toBe('stg_raw_odoo');
    expect(await store.tableExists('stg_raw_odoo')).toBe(true);
    await adapter.disconnect();
  });

  it('throws SourceError when query fails', async () => {
    pgModule.default.__query.mockRejectedValueOnce(new Error('syntax error'));
    const adapter = new PgSourceAdapter();
    const config: SourceConfig = {
      adapter: 'pg',
      connection: 'postgres://u:p@h/d',
      query: 'BAD SQL',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
    await adapter.disconnect();
  });
});
