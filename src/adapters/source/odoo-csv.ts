// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Odoo CSV source adapter.
 *
 * Reads Odoo's CSV exports, which have one structural quirk the plain `csv`
 * adapter can't handle: products with multi-axis variants emit a
 * "continuation row" for every variant axis beyond the first. The
 * continuation rows leave every column blank except the one carrying the
 * key:value cell (typically `Variant Values`).
 *
 * With `pivot:` declared, the adapter:
 *   1. Merges continuation rows into their preceding parent row.
 *   2. Splits the pivot column's `Key: value` cells on the first colon and
 *      routes each value into a new column named after the key (one column
 *      per entry in `pivot.keys`).
 *   3. Drops the pivot column from the output unless `dropOriginal: false`.
 *
 * Without `pivot:`, the adapter behaves identically to the plain `csv`
 * adapter — the brand reserves namespace for future Odoo-specific quirks.
 *
 * Edge cases:
 *   - Orphan continuation row (no preceding parent) → SourceError.
 *   - Same key seen twice in one logical row (parent + continuation, or
 *     two continuations) → warn, last-wins.
 *   - Unknown key (not in `pivot.keys`) → warn (default) or error per
 *     `onUnknownKey`. In warn mode the value is logged and dropped — it
 *     does not become an output column, keeping the schema stable.
 */

import { createReadStream, readdirSync } from "node:fs";
import * as path from "node:path";

import { parse } from "csv-parse";

import type { RunConfig, SourceConfig } from "../../config/types.js";
import type { ColumnMeta, StagingStore } from "../../staging/index.js";
import { SourceError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { stringifyValue } from "../../utils/stringify.js";
import type { ExtractResult, SourceAdapter } from "./types.js";

function resolveGlob(pattern: string): string[] {
  if (!pattern.includes("*")) return [pattern];
  const parsed = path.parse(pattern);
  if (parsed.dir.includes("*")) {
    throw new SourceError(`glob wildcards are only supported in the filename: "${pattern}"`);
  }
  const re = new RegExp(
    "^" + parsed.base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  const searchDir = parsed.dir === "" ? "." : parsed.dir;
  let entries: string[];
  try {
    entries = readdirSync(searchDir);
  } catch (err) {
    throw new SourceError(`could not read directory "${searchDir}" for glob "${pattern}"`, err);
  }
  const matches = entries
    .filter((f) => re.test(f))
    .map((f) => path.join(searchDir, f))
    .sort();
  if (matches.length === 0) {
    throw new SourceError(`glob "${pattern}" matched no files`);
  }
  return matches;
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/** True iff every column except `pivotColumn` is blank. */
function isContinuationRow(row: Record<string, unknown>, pivotColumn: string): boolean {
  for (const [k, v] of Object.entries(row)) {
    if (k === pivotColumn) continue;
    if (!isBlank(v)) return false;
  }
  return true;
}

/** Parse a `Key: value` cell. Returns null if no colon is present. */
function parseKeyValue(cell: string): { key: string; value: string } | null {
  const colon = cell.indexOf(":");
  if (colon === -1) return null;
  return {
    key: cell.slice(0, colon).trim(),
    value: cell.slice(colon + 1).trim(),
  };
}

export class OdooCsvSourceAdapter implements SourceAdapter {
  readonly id = "odoo-csv";

  async connect(_config: SourceConfig): Promise<void> {
    // File-based; no persistent connection.
  }

  async disconnect(): Promise<void> {
    // Nothing to release.
  }

  async extract(
    config: SourceConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
    targetTable = "stg_raw",
  ): Promise<ExtractResult> {
    if (!config.file) {
      throw new SourceError("odoo-csv source requires `file`");
    }
    const files = resolveGlob(config.file);
    const pivot = config.pivot;
    logger.debug(
      { files, targetTable, pivot: pivot?.column, keys: pivot?.keys },
      "odoo-csv: resolved input files",
    );

    let inputColumns: string[] | null = null;
    let outputColumns: ColumnMeta[] | null = null;
    let totalRows = 0;
    const batchSize = runConfig.batchSize;
    const batch: Record<string, unknown>[] = [];

    // Per-logical-row pivot state (carries across parent + continuations).
    let currentParent: Record<string, unknown> | null = null;
    let currentPivotEntries: Array<{ key: string; value: string }> = [];
    let logicalRowIndex = 0;

    const flushCurrent = async (): Promise<void> => {
      if (!currentParent) return;
      const outRow = buildOutputRow(currentParent, currentPivotEntries, pivot, logicalRowIndex);
      batch.push(outRow);
      logicalRowIndex++;
      currentParent = null;
      currentPivotEntries = [];

      if (batch.length >= batchSize) {
        await store.insertBatch(targetTable, batch);
        totalRows += batch.length;
        batch.length = 0;
        onProgress(totalRows);
      }
    };

    for (const file of files) {
      const parser = createReadStream(file).pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          bom: true,
          delimiter: config.delimiter,
        }),
      );

      try {
        for await (const record of parser) {
          const row = record as Record<string, unknown>;

          // First row of the first file fixes the column schema.
          if (!inputColumns) {
            inputColumns = Object.keys(row);
            if (inputColumns.length === 0) {
              throw new SourceError(`odoo-csv file "${file}" has no columns`);
            }
            if (pivot && !inputColumns.includes(pivot.column)) {
              throw new SourceError(
                `odoo-csv: pivot.column "${pivot.column}" not found in input columns ` +
                  `[${inputColumns.join(", ")}] of "${file}"`,
              );
            }
            outputColumns = buildOutputColumns(inputColumns, pivot);
            await store.createTable(targetTable, outputColumns);
          }

          // Without pivot config: pass rows through unchanged.
          if (!pivot) {
            batch.push(row);
            logicalRowIndex++;
            if (batch.length >= batchSize) {
              await store.insertBatch(targetTable, batch);
              totalRows += batch.length;
              batch.length = 0;
              onProgress(totalRows);
            }
            continue;
          }

          // Pivot path: detect continuation vs parent.
          if (isContinuationRow(row, pivot.column)) {
            if (!currentParent) {
              throw new SourceError(
                `odoo-csv: orphan continuation row at logical row ${logicalRowIndex + 1} ` +
                  `in "${file}" (no preceding parent row)`,
              );
            }
            const cell = stringifyValue(row[pivot.column] ?? "");
            if (cell.trim() === "") continue; // wholly blank line; skip silently
            const kv = parseKeyValue(cell);
            if (!kv) {
              logger.warn(
                { file, cell, logicalRow: logicalRowIndex + 1 },
                'odoo-csv: continuation pivot cell is not in "Key: value" form — skipping',
              );
              continue;
            }
            currentPivotEntries.push(kv);
          } else {
            // Parent row: flush previous, then capture this one.
            await flushCurrent();
            currentParent = row;
            const parentCell = stringifyValue(row[pivot.column] ?? "");
            if (parentCell.trim() !== "") {
              const kv = parseKeyValue(parentCell);
              if (kv) currentPivotEntries.push(kv);
              // Non-key:value parent cells (e.g. a plain string in `Variant
              // Values`) are left in the original column if dropOriginal is
              // false, otherwise dropped silently.
            }
          }
        }
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `odoo-csv extract failed for "${file}": ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    }

    // Final logical row.
    await flushCurrent();

    if (batch.length > 0) {
      await store.insertBatch(targetTable, batch);
      totalRows += batch.length;
      onProgress(totalRows);
    }

    if (!outputColumns) {
      throw new SourceError(`odoo-csv extract produced no data for "${config.file}"`);
    }

    return { rowsExtracted: totalRows, tableName: targetTable, columns: outputColumns };
  }
}

function buildOutputColumns(inputColumns: string[], pivot: SourceConfig["pivot"]): ColumnMeta[] {
  if (!pivot) {
    return inputColumns.map((n) => ({ name: n, duckDbType: "VARCHAR" }));
  }
  const cols: ColumnMeta[] = [];
  for (const c of inputColumns) {
    if (pivot.dropOriginal && c === pivot.column) continue;
    cols.push({ name: c, duckDbType: "VARCHAR" });
  }
  for (const k of pivot.keys) {
    if (cols.some((c) => c.name === k)) {
      throw new SourceError(`odoo-csv: pivot key "${k}" collides with an existing input column`);
    }
    cols.push({ name: k, duckDbType: "VARCHAR" });
  }
  return cols;
}

function buildOutputRow(
  parent: Record<string, unknown>,
  entries: Array<{ key: string; value: string }>,
  pivot: SourceConfig["pivot"],
  logicalRowIndex: number,
): Record<string, unknown> {
  if (!pivot) {
    return { ...parent };
  }

  const out: Record<string, unknown> = { ...parent };
  if (pivot.dropOriginal) delete out[pivot.column];

  // Initialise declared pivot columns to null so the row shape is stable.
  for (const k of pivot.keys) {
    out[k] = null;
  }

  // Resolve entries against declared keys; collisions warn + last-wins.
  const seenKeys = new Set<string>();
  for (const { key, value } of entries) {
    if (!pivot.keys.includes(key)) {
      const msg =
        `odoo-csv: unknown pivot key "${key}" (value "${value}") at logical row ` +
        `${logicalRowIndex + 1}`;
      if (pivot.onUnknownKey === "error") {
        throw new SourceError(msg);
      }
      logger.warn(
        { key, value, logicalRow: logicalRowIndex + 1 },
        "odoo-csv: unknown pivot key — value dropped",
      );
      continue;
    }
    if (seenKeys.has(key)) {
      logger.warn(
        { key, value, logicalRow: logicalRowIndex + 1, previous: out[key] },
        "odoo-csv: duplicate pivot key in one logical row — last-wins",
      );
    }
    out[key] = value;
    seenKeys.add(key);
  }

  return out;
}
