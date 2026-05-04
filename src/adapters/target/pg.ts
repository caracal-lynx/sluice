// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

/**
 * PostgreSQL target adapter. Inserts rows from stg_transformed into
 * `{schema}.{table}`, honouring `onConflict`:
 *   - fail   → plain INSERT (PG raises on unique violations)
 *   - upsert → INSERT … ON CONFLICT (upsertKey) DO UPDATE SET …
 *   - ignore → INSERT … ON CONFLICT DO NOTHING
 */

import pg from 'pg';

import type { RunConfig, TargetConfig } from '../../config/types.js';
import { quoteIdent, type StagingStore } from '../../staging/index.js';
import { ConfigError, LoadError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { LoadResult, TargetAdapter } from './types.js';

const STAGING_TABLE = 'stg_transformed';

export class PgTargetAdapter implements TargetAdapter {
  readonly id = 'pg';
  private pool: pg.Pool | null = null;

  async connect(config: TargetConfig): Promise<void> {
    if (!config.connection) {
      throw new ConfigError('pg target requires `connection`');
    }
    this.pool = new pg.Pool({ connectionString: config.connection });
    try {
      const client = await this.pool.connect();
      client.release();
    } catch (err) {
      this.pool = null;
      throw new LoadError(
        `pg target: connect failed: ${err instanceof Error ? err.message : String(err)}`,
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

  async load(
    config: TargetConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
  ): Promise<LoadResult> {
    if (!this.pool) throw new LoadError('pg target: not connected');
    if (!config.table) throw new ConfigError('pg target requires `table`');

    const schema = config.schema;
    const table = config.table;
    const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;

    const columns = await store.columnNames(STAGING_TABLE);
    if (columns.length === 0) {
      throw new LoadError('pg target: stg_transformed has no columns');
    }
    const rows = await store.query<Record<string, unknown>>(`SELECT * FROM "${STAGING_TABLE}"`);

    const colList = columns.map(quoteIdent).join(', ');
    let conflictClause = '';
    if (config.onConflict === 'upsert') {
      const key = config.upsertKey;
      if (!key || key.length === 0) {
        throw new ConfigError('pg target: onConflict: upsert requires upsertKey');
      }
      const updateSet = columns
        .filter((c) => !key.includes(c))
        .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
        .join(', ');
      const conflictCols = key.map(quoteIdent).join(', ');
      conflictClause = updateSet.length > 0
        ? `ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}`
        : `ON CONFLICT (${conflictCols}) DO NOTHING`;
    } else if (config.onConflict === 'ignore') {
      conflictClause = 'ON CONFLICT DO NOTHING';
    }

    let rowsLoaded = 0;
    let rowsFailed = 0;

    for (let i = 0; i < rows.length; i += runConfig.batchSize) {
      const batch = rows.slice(i, i + runConfig.batchSize);
      const placeholderRows: string[] = [];
      const values: unknown[] = [];
      let ph = 1;
      for (const row of batch) {
        const placeholders: string[] = [];
        for (const col of columns) {
          placeholders.push(`$${ph++}`);
          values.push(row[col] === undefined ? null : row[col]);
        }
        placeholderRows.push(`(${placeholders.join(', ')})`);
      }
      const sql = `INSERT INTO ${qualified} (${colList}) VALUES ${placeholderRows.join(', ')} ${conflictClause}`.trim();
      try {
        const res = await this.pool.query(sql, values);
        rowsLoaded += res.rowCount ?? batch.length;
        onProgress(rowsLoaded);
      } catch (err) {
        rowsFailed += batch.length;
        if (runConfig.onError === 'stop') {
          throw new LoadError(
            `pg target: insert failed: ${err instanceof Error ? err.message : String(err)}`,
            err,
          );
        }
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), batchStart: i },
          'pg target: batch failed (onError: continue)',
        );
      }
    }

    return { rowsLoaded, rowsFailed };
  }
}
