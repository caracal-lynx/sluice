/**
 * PostgreSQL source adapter.
 *
 * Executes `config.query` against `config.connection` via pg.Pool. For Phase 1
 * the entire result set is held in memory; streaming via cursors is a future
 * optimization for very large extracts.
 *
 * Phase 3 prep Change 1: `targetTable` defaults to 'stg_raw' at this layer.
 */

import pg from 'pg';

import type { RunConfig, SourceConfig } from '../../config/types.js';
import type { ColumnMeta, StagingStore } from '../../staging/index.js';
import { SourceError } from '../../utils/errors.js';
import type { ExtractResult, SourceAdapter } from './types.js';

// OIDs from pg's built-in types — full list at node_modules/pg-types/lib/textParsers.js
// We only map the commonest ones; unknown OIDs default to VARCHAR.
const PG_OID_TO_DUCKDB: Record<number, string> = {
  16: 'BOOLEAN', // bool
  20: 'BIGINT', // int8
  21: 'BIGINT', // int2
  23: 'BIGINT', // int4
  25: 'VARCHAR', // text
  700: 'DOUBLE', // float4
  701: 'DOUBLE', // float8
  1043: 'VARCHAR', // varchar
  1042: 'VARCHAR', // bpchar (char)
  1082: 'TIMESTAMP', // date
  1114: 'TIMESTAMP', // timestamp
  1184: 'TIMESTAMP', // timestamptz
  1700: 'DOUBLE', // numeric
  114: 'VARCHAR', // json
  3802: 'VARCHAR', // jsonb
  2950: 'VARCHAR', // uuid
};

export class PgSourceAdapter implements SourceAdapter {
  readonly id = 'pg';
  private pool: pg.Pool | null = null;

  async connect(config: SourceConfig): Promise<void> {
    if (!config.connection) {
      throw new SourceError('pg source requires `connection`');
    }
    this.pool = new pg.Pool({ connectionString: config.connection });
    // pg.Pool doesn't connect eagerly; trigger a check via a trivial query so
    // connection errors surface before extract() is called.
    try {
      const client = await this.pool.connect();
      client.release();
    } catch (err) {
      this.pool = null;
      throw new SourceError(
        `pg: connection failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      const p = this.pool;
      this.pool = null;
      await p.end();
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
      throw new SourceError('pg source requires `query`');
    }
    if (!this.pool) {
      throw new SourceError('pg: not connected');
    }

    let result: pg.QueryResult<Record<string, unknown>>;
    try {
      result = await this.pool.query<Record<string, unknown>>(config.query);
    } catch (err) {
      throw new SourceError(
        `pg query failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (result.fields.length === 0) {
      throw new SourceError('pg query produced no columns');
    }

    const columns: ColumnMeta[] = result.fields.map((f) => ({
      name: f.name,
      duckDbType: PG_OID_TO_DUCKDB[f.dataTypeID] ?? 'VARCHAR',
    }));
    await store.createTable(targetTable, columns);

    for (let i = 0; i < result.rows.length; i += runConfig.batchSize) {
      const batch = result.rows.slice(i, i + runConfig.batchSize);
      await store.insertBatch(targetTable, batch);
      onProgress(Math.min(i + batch.length, result.rows.length));
    }

    return { rowsExtracted: result.rows.length, tableName: targetTable, columns };
  }
}
