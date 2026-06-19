// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * StagingStore — thin promisified wrapper around DuckDB.
 *
 * The only place in `src/` that imports `@duckdb/node-api` directly.
 * PipelineRunner owns the single instance.
 *
 * Public API is preserved verbatim across the Node 20→24 / `duckdb` →
 * `@duckdb/node-api` migration: callers still do `new StagingStore(path)`
 * followed by `await store.open()`.
 */

import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBPreparedStatement,
} from "@duckdb/node-api";

import { StagingError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { stringifyValue } from "../utils/stringify.js";
import { buildCreateTableSql, quoteIdent, type ColumnMeta } from "./schema.js";

export interface ExportToCsvOptions {
  delimiter?: string;
  header?: boolean;
  /** Token to emit for NULL values. Default: DuckDB's default (empty string). */
  nullValue?: string;
  /** Accepted for API symmetry; DuckDB always writes UTF-8. */
  encoding?: string;
}

/**
 * Translate `?` positional placeholders (the convention inherited from the
 * old `duckdb` driver) into the `$N` form that `@duckdb/node-api` expects.
 * Quoted identifiers and string literals containing `?` are not corrupted
 * because internal callers in this file never put `?` inside a quoted
 * literal — only as a positional bind marker.
 */
function translatePlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Bind a single positional parameter, sniffing the JS type and routing to the
 * appropriate typed bind method. DuckDB coerces between numeric column types
 * (e.g. INTEGER value into BIGINT column) so we don't need to know the column
 * type up-front — only enough about the JS value to pick a sensible bind.
 *
 * `null` and `undefined` both map to bindNull (matches the old driver, where
 * `insertBatch` rewrote `undefined → null` before binding).
 */
function bindParam(prep: DuckDBPreparedStatement, pos: number, value: unknown): void {
  if (value === null || value === undefined) {
    prep.bindNull(pos);
    return;
  }
  if (typeof value === "boolean") {
    prep.bindBoolean(pos, value);
    return;
  }
  if (typeof value === "bigint") {
    prep.bindBigInt(pos, value);
    return;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647) {
      prep.bindInteger(pos, value);
    } else {
      prep.bindDouble(pos, value);
    }
    return;
  }
  // Strings, Dates (ISO-stringified), and everything else go through varchar.
  // DuckDB coerces e.g. '2026-04-19 12:00:00' into a TIMESTAMP column.
  if (value instanceof Date) {
    prep.bindVarchar(pos, value.toISOString());
    return;
  }
  prep.bindVarchar(pos, stringifyValue(value));
}

export class StagingStore {
  private instance: DuckDBInstance | null = null;
  private conn: DuckDBConnection | null = null;

  /** `:memory:` for dryRun/tests, else a filesystem path. */
  constructor(private readonly dbPath: string) {}

  async open(): Promise<void> {
    if (this.instance) return;
    try {
      this.instance = await DuckDBInstance.create(this.dbPath);
      this.conn = await this.instance.connect();
    } catch (err) {
      this.instance = null;
      this.conn = null;
      throw new StagingError(
        `failed to open DuckDB at ${this.dbPath}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async close(): Promise<void> {
    // DuckDB teardown is synchronous, but the public API is async (callers
    // `await store.close()`); keep it genuinely async.
    await Promise.resolve();
    if (!this.instance) return;
    const conn = this.conn;
    const instance = this.instance;
    this.conn = null;
    this.instance = null;
    try {
      conn?.disconnectSync();
      instance.closeSync();
    } catch (err) {
      throw new StagingError(
        `failed to close DuckDB: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async createTable(name: string, columns: ColumnMeta[]): Promise<void> {
    await this.exec(buildCreateTableSql(name, columns));
  }

  /**
   * Bulk-insert rows. Column schema is taken from the first row; rows missing
   * a column get `null`. All rows must share the first row's column set.
   *
   * Builds a single multi-row prepared INSERT for efficiency:
   *   `INSERT INTO "t" ("a","b") VALUES ($1,$2), ($3,$4), ($5,$6)`
   * and binds all params positionally.
   */
  async insertBatch(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const first = rows[0];
    const cols = Object.keys(first);
    if (cols.length === 0) {
      throw new StagingError("insertBatch: rows have no columns");
    }
    const colList = cols.map(quoteIdent).join(", ");
    let n = 0;
    const rowPlaceholders = rows.map(() => `(${cols.map(() => `$${++n}`).join(", ")})`).join(", ");
    const flatParams = rows.flatMap((r) => cols.map((c) => (r[c] === undefined ? null : r[c])));
    const sql = `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${rowPlaceholders}`;
    await this.execPrepared(sql, flatParams);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await this.exec(sql, params);
    return rows as T[];
  }

  async tableExists(name: string): Promise<boolean> {
    const rows = await this.query<{ n: bigint | number }>(
      "SELECT count(*) AS n FROM information_schema.tables WHERE table_name = ?",
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
      "SELECT column_name FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position",
      [table],
    );
    return rows.map((r) => r.column_name);
  }

  /**
   * Export a table to a CSV file. DuckDB always emits UTF-8; the `encoding`
   * option is accepted for API symmetry and currently ignored.
   */
  async exportToCsv(
    table: string,
    outputPath: string,
    options?: ExportToCsvOptions,
  ): Promise<void> {
    const delim = options?.delimiter ?? ",";
    const header = options?.header ?? true;
    const safePath = outputPath.replace(/\\/g, "/").replace(/'/g, "''");
    const safeDelim = delim.replace(/'/g, "''");
    const clauses = [`HEADER ${header ? "TRUE" : "FALSE"}`, `DELIMITER '${safeDelim}'`];
    if (options?.nullValue !== undefined) {
      clauses.push(`NULL '${options.nullValue.replace(/'/g, "''")}'`);
    }
    await this.exec(`COPY ${quoteIdent(table)} TO '${safePath}' (${clauses.join(", ")})`);
  }

  /**
   * Rename columns in place. Implemented as CREATE OR REPLACE TABLE ... AS
   * SELECT to sidestep DuckDB's column-rename limitations. Unknown keys are
   * warned and skipped (not an error). No-op when `renames` is empty.
   *
   * Used by `MultiSourcePipelineRunner` to apply per-source rename maps
   * after extract and before merge.
   */
  async renameColumns(tableName: string, renames: Record<string, string>): Promise<void> {
    if (Object.keys(renames).length === 0) return;

    const existingColumns = await this.columnNames(tableName);
    const unknownKeys = Object.keys(renames).filter((k) => !existingColumns.includes(k));
    if (unknownKeys.length > 0) {
      logger.warn({ tableName, unknownKeys }, "rename map contains columns not found in table");
    }

    const selectList = existingColumns
      .map((col) => {
        const newName = renames[col];
        return newName !== undefined
          ? `${quoteIdent(col)} AS ${quoteIdent(newName)}`
          : quoteIdent(col);
      })
      .join(", ");

    await this.exec(
      `CREATE OR REPLACE TABLE ${quoteIdent(tableName)} AS SELECT ${selectList} FROM ${quoteIdent(tableName)}`,
    );
  }

  // ── Phase 4a stubs (implemented by @caracal-lynx/sluice-enrich) ────────
  //
  // The private `@caracal-lynx/sluice-enrich` package overwrites these three
  // methods on `StagingStore.prototype` at import time via a `patchStagingStore()`
  // helper. Until that package is installed and imported, the methods throw.
  //
  // The `table` parameter is the staging table the enrich runner operates on:
  // `'stg_raw'` for single-source pipelines, `'stg_merged'` for multi-source
  // (post-merge, pre-DQ) — selected by `PipelineRunner.runEnrich()` via the
  // `sourceTable` argument it passes to `EnrichPhaseFactory`.

  /**
   * Returns distinct non-null, non-empty values for a column in `table`.
   * Used by the Phase 4a enrich runner to deduplicate API calls.
   */
  async selectDistinct(_table: string, _field: string): Promise<string[]> {
    // Throwing stub — the failure must surface as a rejected promise (tests
    // and callers use `.rejects`/`await`), so the method stays async.
    await Promise.resolve();
    throw new StagingError(
      "StagingStore.selectDistinct: not yet implemented — install @caracal-lynx/sluice-enrich",
    );
  }

  /** Adds a column to `table` if it does not already exist. */
  async addColumnIfNotExists(
    _table: string,
    _column: string,
    _type: "BOOLEAN" | "VARCHAR",
  ): Promise<void> {
    await Promise.resolve();
    throw new StagingError(
      "StagingStore.addColumnIfNotExists: not yet implemented — install @caracal-lynx/sluice-enrich",
    );
  }

  /**
   * Batch-updates `table`. `updates` is keyed by DuckDB `rowid` (BigInt or
   * number) and maps each row to a partial column-value record to UPDATE.
   */
  async batchUpdateColumns(
    _table: string,
    _updates: Map<number | bigint, Record<string, unknown>>,
  ): Promise<void> {
    await Promise.resolve();
    throw new StagingError(
      "StagingStore.batchUpdateColumns: not yet implemented — install @caracal-lynx/sluice-enrich",
    );
  }

  // ── internal ───────────────────────────────────────────────────────────

  /**
   * Run any SQL statement. Returns native-JS row objects (Date for TIMESTAMP,
   * bigint for BIGINT, null for NULL) for SELECTs; for DDL/DML the returned
   * array is empty or a `[{ Count: <n>n }]` summary that callers ignore.
   */
  private async exec(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    if (!this.conn) {
      throw new StagingError("StagingStore is not open");
    }
    if (params.length === 0) {
      try {
        const reader = await this.conn.runAndReadAll(sql);
        return reader.getRowObjectsJS();
      } catch (err) {
        throw new StagingError(
          `DuckDB query failed: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    }
    return this.execPrepared(sql, params);
  }

  /**
   * Run a parameterised statement via a prepared statement. Translates `?`
   * placeholders to `$N` and binds positional params with type sniffing.
   */
  private async execPrepared(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    if (!this.conn) {
      throw new StagingError("StagingStore is not open");
    }
    const translated = translatePlaceholders(sql);
    let prep: DuckDBPreparedStatement | null = null;
    try {
      prep = await this.conn.prepare(translated);
      params.forEach((value, i) => {
        bindParam(prep!, i + 1, value);
      });
      const reader = await prep.runAndReadAll();
      return reader.getRowObjectsJS();
    } catch (err) {
      throw new StagingError(
        `DuckDB query failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      try {
        prep?.destroySync();
      } catch {
        /* noop — destroy errors swallowed; the connection is already done with it */
      }
    }
  }
}
