// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

/**
 * SQL Server source adapter.
 *
 * Accepts either a URL connection string (`mssql://user:pass@host/db`) or a
 * JSON-encoded config object — the latter supports Windows trusted connections
 * via `{"trustedConnection": true, ...}`.
 *
 * Uses the streaming `request.stream = true` + `recordset` / `row` / `done`
 * event flow so extremely large result sets don't blow the heap.
 * `targetTable` defaults to 'stg_raw'.
 */

import sql, { type config as SqlConfig, type ConnectionPool, type Request } from 'mssql';

import type { RunConfig, SourceConfig } from '../../config/types.js';
import type { ColumnMeta, StagingStore } from '../../staging/index.js';
import { SourceError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { ExtractResult, SourceAdapter } from './types.js';

// Column metadata from mssql carries the type constructor function; its `.name`
// yields the SQL Server type name (e.g. "VarChar", "Int").
const MSSQL_TO_DUCKDB: Record<string, string> = {
  varchar: 'VARCHAR',
  nvarchar: 'VARCHAR',
  char: 'VARCHAR',
  nchar: 'VARCHAR',
  text: 'VARCHAR',
  ntext: 'VARCHAR',
  xml: 'VARCHAR',
  uniqueidentifier: 'VARCHAR',
  int: 'BIGINT',
  bigint: 'BIGINT',
  smallint: 'BIGINT',
  tinyint: 'BIGINT',
  decimal: 'DOUBLE',
  numeric: 'DOUBLE',
  money: 'DOUBLE',
  smallmoney: 'DOUBLE',
  float: 'DOUBLE',
  real: 'DOUBLE',
  bit: 'BOOLEAN',
  datetime: 'TIMESTAMP',
  datetime2: 'TIMESTAMP',
  smalldatetime: 'TIMESTAMP',
  datetimeoffset: 'TIMESTAMP',
  date: 'TIMESTAMP',
  time: 'VARCHAR',
};

function mapMssqlType(t: unknown): string {
  if (t === null || t === undefined) return 'VARCHAR';
  const name =
    typeof t === 'function'
      ? ((t as { name?: string }).name ?? '')
      : typeof t === 'object'
        ? ((t as { name?: string }).name ?? '')
        : String(t);
  return MSSQL_TO_DUCKDB[name.toLowerCase()] ?? 'VARCHAR';
}

function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return undefined;
}

function parseMssqlUrl(connection: string): SqlConfig {
  const parsed = new URL(connection);
  const database = parsed.pathname.replace(/^\//, '');

  const encrypt = parseBooleanParam(parsed.searchParams.get('encrypt'));
  const trustServerCertificate = parseBooleanParam(
    parsed.searchParams.get('trustServerCertificate'),
  );

  const config: SqlConfig = {
    server: parsed.hostname,
    ...(parsed.port ? { port: Number(parsed.port) } : {}),
    ...(database ? { database } : {}),
    ...(parsed.username ? { user: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    options: {
      ...(encrypt !== undefined ? { encrypt } : {}),
      ...(trustServerCertificate !== undefined ? { trustServerCertificate } : {}),
    },
  };

  if (Object.keys(config.options ?? {}).length === 0) {
    delete config.options;
  }

  return config;
}

function parseConnection(connection: string): string | SqlConfig {
  const trimmed = connection.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(connection) as SqlConfig;
    } catch (err) {
      throw new SourceError(`mssql: invalid JSON in connection config: ${String(err)}`, err);
    }
  }
  if (trimmed.startsWith('mssql://')) {
    try {
      return parseMssqlUrl(connection);
    } catch (err) {
      throw new SourceError(`mssql: invalid URL in connection config: ${String(err)}`, err);
    }
  }
  return connection;
}

export class MssqlSourceAdapter implements SourceAdapter {
  readonly id = 'mssql';
  private pool: ConnectionPool | null = null;

  async connect(config: SourceConfig): Promise<void> {
    if (!config.connection) {
      throw new SourceError('mssql source requires `connection`');
    }
    const poolConfig = parseConnection(config.connection);
    this.pool = new sql.ConnectionPool(poolConfig as SqlConfig);
    try {
      await this.pool.connect();
    } catch (err) {
      this.pool = null;
      throw new SourceError(
        `mssql: connection failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      const p = this.pool;
      this.pool = null;
      await p.close();
    }
  }

  async extract(
    config: SourceConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
    targetTable = 'stg_raw',
  ): Promise<ExtractResult> {
    if (!config.query) {
      throw new SourceError('mssql source requires `query`');
    }
    if (!this.pool) {
      throw new SourceError('mssql: not connected (call connect() first)');
    }
    const query = config.query;

    const request: Request = this.pool.request();
    request.stream = true;

    let columns: ColumnMeta[] | null = null;
    let pendingBatch: Record<string, unknown>[] = [];
    let totalRows = 0;

    return new Promise<ExtractResult>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown): void => {
        if (settled) return;
        settled = true;
        reject(err instanceof SourceError ? err : new SourceError(`mssql query failed: ${String(err)}`, err));
      };

      request.on('recordset', (meta: Record<string, { type?: unknown }>) => {
        (async () => {
          try {
            columns = Object.entries(meta).map(([name, info]) => ({
              name,
              duckDbType: mapMssqlType(info?.type),
            }));
            if (columns.length === 0) {
              throw new SourceError('mssql query produced no columns');
            }
            await store.createTable(targetTable, columns);
          } catch (err) {
            fail(err);
          }
        })();
      });

      request.on('row', (row: Record<string, unknown>) => {
        pendingBatch.push(row);
        if (pendingBatch.length >= runConfig.batchSize) {
          const toInsert = pendingBatch;
          pendingBatch = [];
          try {
            request.pause();
          } catch {
            /* older mssql may not support pause */
          }
          store
            .insertBatch(targetTable, toInsert)
            .then(() => {
              totalRows += toInsert.length;
              onProgress(totalRows);
              try {
                request.resume();
              } catch {
                /* noop */
              }
            })
            .catch((err) => {
              fail(err);
            });
        }
      });

      request.on('error', fail);

      request.on('done', () => {
        (async () => {
          try {
            if (pendingBatch.length > 0) {
              await store.insertBatch(targetTable, pendingBatch);
              totalRows += pendingBatch.length;
              onProgress(totalRows);
              pendingBatch = [];
            }
            if (!columns) {
              throw new SourceError('mssql query completed without any columns');
            }
            if (settled) return;
            settled = true;
            logger.debug({ totalRows, targetTable }, 'mssql: extract complete');
            resolve({ rowsExtracted: totalRows, tableName: targetTable, columns });
          } catch (err) {
            fail(err);
          }
        })();
      });

      try {
        request.query(query);
      } catch (err) {
        fail(err);
      }
    });
  }
}
