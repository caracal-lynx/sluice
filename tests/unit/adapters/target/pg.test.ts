import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => {
  const client = { release: vi.fn() };
  const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    end: vi.fn().mockResolvedValue(undefined),
    query,
  };
  const Pool = vi.fn(function () { return pool; });
  return { default: { Pool, __pool: pool, __query: query } };
});

const pgMod = (await import('pg')) as unknown as {
  default: { __query: ReturnType<typeof vi.fn>; __pool: { query: ReturnType<typeof vi.fn> } };
};
const { PgTargetAdapter } = await import('../../../../src/adapters/target/pg.js');
const { StagingStore } = await import('../../../../src/staging/index.js');
const { ConfigError } = await import('../../../../src/utils/errors.js');

import type { RunConfig, TargetConfig } from '../../../../src/config/types.js';

const BASE_RUN: RunConfig = {
  mode: 'full',
  batchSize: 500,
  onError: 'continue',
  logLevel: 'info',
  dryRun: false,
  outputDir: './output',
  stagingDb: '',
};

function pgTarget(overrides: Partial<TargetConfig>): TargetConfig {
  return {
    adapter: 'pg',
    connection: 'postgres://u:p@h/d',
    table: 'customers',
    schema: 'public',
    delimiter: ',',
    encoding: 'utf-8',
    nullValue: '',
    apiVersion: 'v2.0',
    onConflict: 'fail',
    batchEndpoint: true,
    ...overrides,
  } as TargetConfig;
}

describe('PgTargetAdapter', () => {
  let store: InstanceType<typeof StagingStore>;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    await store.createTable('stg_transformed', [
      { name: 'id', duckDbType: 'VARCHAR' },
      { name: 'name', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('stg_transformed', [
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ]);
    pgMod.default.__query.mockClear();
    pgMod.default.__query.mockResolvedValue({ rowCount: 2, rows: [] });
  });

  afterEach(async () => {
    await store.close();
  });

  it('emits an INSERT … (fail) statement by default', async () => {
    const adapter = new PgTargetAdapter();
    const target = pgTarget({});
    await adapter.connect(target);
    await adapter.load(target, store, BASE_RUN, () => {});
    const sql = pgMod.default.__query.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/INSERT INTO "public"\."customers"/);
    expect(sql).not.toMatch(/ON CONFLICT/);
  });

  it('emits an upsert when onConflict: upsert with upsertKey', async () => {
    const adapter = new PgTargetAdapter();
    const target = pgTarget({ onConflict: 'upsert', upsertKey: ['id'] });
    await adapter.connect(target);
    await adapter.load(target, store, BASE_RUN, () => {});
    const sql = pgMod.default.__query.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/ON CONFLICT \("id"\) DO UPDATE SET "name" = EXCLUDED\."name"/);
  });

  it('emits ON CONFLICT DO NOTHING when onConflict: ignore', async () => {
    const adapter = new PgTargetAdapter();
    const target = pgTarget({ onConflict: 'ignore' });
    await adapter.connect(target);
    await adapter.load(target, store, BASE_RUN, () => {});
    const sql = pgMod.default.__query.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('throws ConfigError when table is missing', async () => {
    const adapter = new PgTargetAdapter();
    const target = pgTarget({});
    delete target.table;
    await adapter.connect(target);
    await expect(adapter.load(target, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      ConfigError,
    );
  });
});
