import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock mssql before the adapter imports it
vi.mock('mssql', () => {
  const request = new EventEmitter() as EventEmitter & {
    stream: boolean;
    query: (sql: string) => void;
    pause: () => void;
    resume: () => void;
  };
  request.stream = false;
  request.query = () => {};
  request.pause = () => {};
  request.resume = () => {};

  const pool = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    request: () => request,
  };

  const connectionPool = vi.fn(function () {
    return pool;
  });

  return {
    default: {
      ConnectionPool: connectionPool,
      __request: request,
      __pool: pool,
      __connectionPool: connectionPool,
    },
  };
});

// Pull the mock + adapter after the mock is installed
const mssqlModule = (await import('mssql')) as unknown as {
  default: {
    __request: EventEmitter & {
      stream: boolean;
      query: (sql: string) => void;
      pause: () => void;
      resume: () => void;
    };
    __pool: { connect: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    __connectionPool: ReturnType<typeof vi.fn>;
  };
};
const { MssqlSourceAdapter } = await import('../../../../src/adapters/source/mssql.js');
const { StagingStore } = await import('../../../../src/staging/index.js');
const { SourceError } = await import('../../../../src/utils/errors.js');

import type { RunConfig, SourceConfig } from '../../../../src/config/types.js';
import type { ColumnMeta } from '../../../../src/staging/index.js';

const BASE_RUN: RunConfig = {
  mode: 'full',
  batchSize: 500,
  onError: 'continue',
  logLevel: 'info',
  dryRun: false,
  outputDir: './output',
  stagingDb: '',
};

function trigger(
  req: EventEmitter,
  meta: Record<string, unknown>,
  rows: Record<string, unknown>[],
): void {
  // Fire events asynchronously to mimic a real stream
  setImmediate(() => {
    req.emit('recordset', meta);
    setImmediate(() => {
      for (const row of rows) req.emit('row', row);
      setImmediate(() => req.emit('done'));
    });
  });
}

describe('MssqlSourceAdapter', () => {
  let store: InstanceType<typeof StagingStore>;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    mssqlModule.default.__pool.connect.mockClear();
    mssqlModule.default.__pool.close.mockClear();
    mssqlModule.default.__connectionPool.mockClear();
  });

  afterEach(async () => {
    await store.close();
  });

  it('extracts rows and infers DuckDB types from SQL Server metadata', async () => {
    const adapter = new MssqlSourceAdapter();
    const config: SourceConfig = {
      adapter: 'mssql',
      connection: 'mssql://u:p@host/db',
      query: 'SELECT CUST_CODE, CREDIT_LIMIT FROM dbo.Customers',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    expect(mssqlModule.default.__connectionPool).toHaveBeenCalledWith({
      server: 'host',
      database: 'db',
      user: 'u',
      password: 'p',
    });

    const promise = adapter.extract(config, store, BASE_RUN, () => {});
    trigger(
      mssqlModule.default.__request,
      {
        CUST_CODE: { type: { name: 'VarChar' } },
        CREDIT_LIMIT: { type: { name: 'Decimal' } },
      },
      [
        { CUST_CODE: 'A001', CREDIT_LIMIT: 100 },
        { CUST_CODE: 'A002', CREDIT_LIMIT: 200 },
      ],
    );
    const result = await promise;
    expect(result.rowsExtracted).toBe(2);
    expect(result.tableName).toBe('stg_raw');
    expect(result.columns.map((c) => c.duckDbType)).toEqual(['VARCHAR', 'DOUBLE']);
    await adapter.disconnect();
    expect(mssqlModule.default.__pool.close).toHaveBeenCalled();
  });

  it('accepts a JSON connection config with trustedConnection', async () => {
    const adapter = new MssqlSourceAdapter();
    const config: SourceConfig = {
      adapter: 'mssql',
      connection: JSON.stringify({ server: 'host', database: 'db', trustedConnection: true }),
      query: 'SELECT 1 AS X',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    expect(mssqlModule.default.__pool.connect).toHaveBeenCalled();
    await adapter.disconnect();
  });

  it('writes into a custom targetTable (Phase 3 prep Change 1)', async () => {
    const adapter = new MssqlSourceAdapter();
    const config: SourceConfig = {
      adapter: 'mssql',
      connection: 'mssql://u:p@h/d',
      query: 'SELECT 1 AS X',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    const promise = adapter.extract(config, store, BASE_RUN, () => {}, 'stg_raw_sql_server');
    trigger(mssqlModule.default.__request, { X: { type: { name: 'Int' } } }, [{ X: 1 }]);
    const result = await promise;
    expect(result.tableName).toBe('stg_raw_sql_server');
    expect(await store.tableExists('stg_raw_sql_server')).toBe(true);
    await adapter.disconnect();
  });

  it('waits for a slow CREATE TABLE before inserting (race regression)', async () => {
    const adapter = new MssqlSourceAdapter();
    const config: SourceConfig = {
      adapter: 'mssql',
      connection: 'mssql://u:p@h/d',
      query: 'SELECT 1 AS X',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);

    // Force createTable to resolve well after the `done` event fires. Without
    // the `tableReady` gate the streamed INSERT would race ahead of the
    // CREATE TABLE and DuckDB would raise "Table does not exist" (PR #170 CI
    // run #503). The 50ms delay dwarfs the few setImmediate hops in trigger().
    const realCreateTable = store.createTable.bind(store);
    vi.spyOn(store, 'createTable').mockImplementation(async (name: string, cols: ColumnMeta[]) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await realCreateTable(name, cols);
    });

    const promise = adapter.extract(config, store, BASE_RUN, () => {}, 'stg_raw_slow');
    trigger(mssqlModule.default.__request, { X: { type: { name: 'Int' } } }, [{ X: 1 }]);
    const result = await promise;
    expect(result.rowsExtracted).toBe(1);
    expect(await store.tableExists('stg_raw_slow')).toBe(true);
    await adapter.disconnect();
  });

  it('throws SourceError without connection', async () => {
    const adapter = new MssqlSourceAdapter();
    await expect(
      adapter.connect({ adapter: 'mssql', delimiter: ',', encoding: 'utf-8' } as SourceConfig),
    ).rejects.toBeInstanceOf(SourceError);
  });
});
