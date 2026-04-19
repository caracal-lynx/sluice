/**
 * StagingStore — thin promisified wrapper around DuckDB.
 *
 * The only place in `src/` that imports `duckdb` directly.
 * PipelineRunner owns the single instance.
 */

import duckdbPkg from 'duckdb';
import type { Connection, Database as DatabaseType, TableData } from 'duckdb';

// duckdb is a CommonJS module — named imports don't work under Node ESM, so
// we default-import the whole module and destructure the constructor.
const { Database } = duckdbPkg;

import { StagingError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { buildCreateTableSql, quoteIdent, type ColumnMeta } from './schema.js';

export interface ExportToCsvOptions {
  delimiter?: string;
  header?: boolean;
  /** Token to emit for NULL values. Default: DuckDB's default (empty string). */
  nullValue?: string;
  /** Accepted for API symmetry; DuckDB always writes UTF-8. */
  encoding?: string;
}

export class StagingStore {
  private db: DatabaseType | null = null;
  private conn: Connection | null = null;

  /** `:memory:` for dryRun/tests, else a filesystem path. */
  constructor(private readonly dbPath: string) {}

  async open(): Promise<void> {
    if (this.db) return;
    await new Promise<void>((resolve, reject) => {
      try {
        this.db = new Database(this.dbPath, (err) => {
          if (err) {
            reject(new StagingError(`failed to open DuckDB at ${this.dbPath}: ${err.message}`, err));
            return;
          }
          try {
            this.conn = this.db!.connect();
            resolve();
          } catch (connErr) {
            reject(new StagingError(`failed to connect to DuckDB: ${String(connErr)}`, connErr));
          }
        });
      } catch (ctorErr) {
        reject(new StagingError(`failed to construct DuckDB: ${String(ctorErr)}`, ctorErr));
      }
    });
  }

  async close(): Promise<void> {
    if (!this.db) return;
    const db = this.db;
    this.db = null;
    this.conn = null;
    await new Promise<void>((resolve, reject) => {
      db.close((err) => {
        if (err) reject(new StagingError(`failed to close DuckDB: ${err.message}`, err));
        else resolve();
      });
    });
  }

  async createTable(name: string, columns: ColumnMeta[]): Promise<void> {
    await this.exec(buildCreateTableSql(name, columns));
  }

  /**
   * Bulk-insert rows. Column schema is taken from the first row; rows missing
   * a column get `null`. All rows must share the first row's column set.
   */
  async insertBatch(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const first = rows[0]!;
    const cols = Object.keys(first);
    if (cols.length === 0) {
      throw new StagingError('insertBatch: rows have no columns');
    }
    const colList = cols.map(quoteIdent).join(', ');
    const placeholdersPerRow = `(${cols.map(() => '?').join(', ')})`;
    const rowPlaceholders = rows.map(() => placeholdersPerRow).join(', ');
    const flatParams = rows.flatMap((r) => cols.map((c) => (r[c] === undefined ? null : r[c])));
    await this.exec(
      `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${rowPlaceholders}`,
      flatParams,
    );
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await this.exec(sql, params);
    return rows as T[];
  }

  async tableExists(name: string): Promise<boolean> {
    const rows = await this.query<{ n: bigint | number }>(
      'SELECT count(*) AS n FROM information_schema.tables WHERE table_name = ?',
      [name],
    );
    const n = rows[0]?.n ?? 0;
    return Number(n) > 0;
  }

  async dropTable(name: string): Promise<void> {
    await this.exec(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);
  }

  async rowCount(table: string): Promise<number> {
    const rows = await this.query<{ n: bigint | number }>(
      `SELECT count(*) AS n FROM ${quoteIdent(table)}`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async columnNames(table: string): Promise<string[]> {
    const rows = await this.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position',
      [table],
    );
    return rows.map((r) => r.column_name);
  }

  /**
   * Export a table to a CSV file. DuckDB always emits UTF-8; the `encoding`
   * option is accepted for API symmetry and currently ignored.
   */
  async exportToCsv(table: string, outputPath: string, options?: ExportToCsvOptions): Promise<void> {
    const delim = options?.delimiter ?? ',';
    const header = options?.header ?? true;
    const safePath = outputPath.replace(/\\/g, '/').replace(/'/g, "''");
    const safeDelim = delim.replace(/'/g, "''");
    const clauses = [
      `HEADER ${header ? 'TRUE' : 'FALSE'}`,
      `DELIMITER '${safeDelim}'`,
    ];
    if (options?.nullValue !== undefined) {
      clauses.push(`NULL '${options.nullValue.replace(/'/g, "''")}'`);
    }
    await this.exec(
      `COPY ${quoteIdent(table)} TO '${safePath}' (${clauses.join(', ')})`,
    );
  }

  /**
   * Rename columns in place. Implemented as CREATE OR REPLACE TABLE ... AS
   * SELECT to sidestep DuckDB's column-rename limitations. Unknown keys are
   * warned and skipped (not an error). No-op when `renames` is empty.
   *
   * Phase 1: not called from any Phase 1 code path. Built for the Phase 3
   * multi-source runner which applies per-source rename maps before DQ.
   */
  async renameColumns(tableName: string, renames: Record<string, string>): Promise<void> {
    if (Object.keys(renames).length === 0) return;

    const existingColumns = await this.columnNames(tableName);
    const unknownKeys = Object.keys(renames).filter((k) => !existingColumns.includes(k));
    if (unknownKeys.length > 0) {
      logger.warn({ tableName, unknownKeys }, 'rename map contains columns not found in table');
    }

    const selectList = existingColumns
      .map((col) => {
        const newName = renames[col];
        return newName !== undefined
          ? `${quoteIdent(col)} AS ${quoteIdent(newName)}`
          : quoteIdent(col);
      })
      .join(', ');

    await this.exec(
      `CREATE OR REPLACE TABLE ${quoteIdent(tableName)} AS SELECT ${selectList} FROM ${quoteIdent(tableName)}`,
    );
  }

  // ── internal ───────────────────────────────────────────────────────────

  private exec(sql: string, params: unknown[] = []): Promise<TableData> {
    if (!this.conn) {
      return Promise.reject(new StagingError('StagingStore is not open'));
    }
    const conn = this.conn;
    return new Promise<TableData>((resolve, reject) => {
      const cb = (err: Error | null, rows: TableData): void => {
        if (err) reject(new StagingError(`DuckDB query failed: ${err.message}`, err));
        else resolve(rows ?? []);
      };
      if (params.length === 0) {
        conn.all(sql, cb);
      } else {
        conn.all(sql, ...params, cb);
      }
    });
  }
}
