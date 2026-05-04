// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

/**
 * Staging-table schema helpers.
 *
 * ColumnMeta lives here (not in `src/adapters/source/types.ts` as the original
 * spec suggested) because source adapters already depend on the staging module
 * via the `StagingStore` parameter in `extract()`. Hosting ColumnMeta in
 * staging keeps the dependency direction one-way: adapters → staging.
 */

/** DuckDB primitive types produced by the source adapters. */
export type DuckDbType = 'VARCHAR' | 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'TIMESTAMP';

export interface ColumnMeta {
  name: string;
  duckDbType: string; // kept as string so adapters may emit other valid DuckDB types
}

/** Double-quote an identifier and escape embedded double-quotes per SQL standard. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Build a CREATE TABLE statement from ColumnMeta. */
export function buildCreateTableSql(tableName: string, columns: ColumnMeta[]): string {
  if (columns.length === 0) {
    throw new Error(`cannot create table ${tableName} with no columns`);
  }
  const colsSql = columns.map((c) => `${quoteIdent(c.name)} ${c.duckDbType}`).join(', ');
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (${colsSql})`;
}
