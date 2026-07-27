// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Excel (XLSX) source adapter. Reads the workbook with read-excel-file, picks
 * the named/indexed sheet (or warns + uses the first), and emits each row as a
 * Record<string, string> keyed by the header row. All columns stage as
 * VARCHAR — type coercion happens in transform, not here.
 *
 * `targetTable` defaults to 'stg_raw'.
 *
 * Reader choice: read-excel-file replaced exceljs in 2026-07 (DAG-207). It is
 * read-only, which is all this adapter needs, and it resolves formulas to their
 * cached result and dates to `Date` before we see them.
 * See docs/adr/0001-replace-exceljs-with-read-excel-file.md.
 */

import readXlsxFile, { type Sheet } from "read-excel-file/node";

import type { RunConfig, SourceConfig } from "../../config/types.js";
import type { ColumnMeta, StagingStore } from "../../staging/index.js";
import { SourceError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { stringifyValue } from "../../utils/stringify.js";
import type { ExtractResult, SourceAdapter } from "./types.js";

export class XlsxSourceAdapter implements SourceAdapter {
  readonly id = "xlsx";

  async connect(_config: SourceConfig): Promise<void> {
    // File-based; nothing to establish.
  }

  async disconnect(): Promise<void> {
    // nothing to release.
  }

  async extract(
    config: SourceConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
    targetTable = "stg_raw",
  ): Promise<ExtractResult> {
    if (!config.file) {
      throw new SourceError("xlsx source requires `file`");
    }

    // read-excel-file returns every sheet in one pass: [{ sheet, data }, ...].
    // `data` is a row-major array of already-coerced cell values.
    let sheets: Sheet[];
    try {
      sheets = await readXlsxFile(config.file);
    } catch (err) {
      throw new SourceError(
        `xlsx: failed to read "${config.file}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    const [firstSheet] = sheets;
    if (firstSheet === undefined) {
      throw new SourceError(`xlsx: workbook "${config.file}" has no sheets`);
    }

    if (sheets.length > 1 && config.sheet === undefined) {
      logger.warn(
        {
          file: config.file,
          sheets: sheets.map((s) => s.sheet),
          using: firstSheet.sheet,
        },
        "xlsx: multiple sheets found and `source.sheet` is unset — using first sheet",
      );
    }

    // Numeric `sheet` stays 0-based, matching the previous exceljs behaviour.
    const selected =
      config.sheet === undefined
        ? firstSheet
        : typeof config.sheet === "number"
          ? sheets[config.sheet]
          : sheets.find((s) => s.sheet === config.sheet);

    if (!selected) {
      throw new SourceError(`xlsx: sheet "${String(config.sheet)}" not found in ${config.file}`);
    }

    const [headerRow = [], ...dataRows] = selected.data;
    const headers: string[] = headerRow.map((cell) => cellToString(cell).trim());
    // Trim trailing empties
    while (headers.length > 0 && !headers[headers.length - 1]) {
      headers.pop();
    }
    if (headers.length === 0) {
      throw new SourceError(`xlsx: sheet "${selected.sheet}" has no header row`);
    }

    const records: Record<string, string>[] = [];
    for (const row of dataRows) {
      // Mirrors exceljs's `row.hasValues` — skip rows that are entirely blank.
      if (row.every((cell) => cell === null || cell === undefined || cell === "")) continue;
      const record: Record<string, string> = {};
      headers.forEach((header, idx) => {
        record[header] = cellToString(row[idx]);
      });
      records.push(record);
    }

    if (records.length === 0) {
      throw new SourceError(`xlsx: sheet "${selected.sheet}" is empty`);
    }

    const columns: ColumnMeta[] = headers.map((n) => ({
      name: n,
      duckDbType: "VARCHAR",
    }));
    await store.createTable(targetTable, columns);

    for (let i = 0; i < records.length; i += runConfig.batchSize) {
      const batch = records.slice(i, i + runConfig.batchSize);
      await store.insertBatch(targetTable, batch);
      onProgress(Math.min(i + batch.length, records.length));
    }

    return { rowsExtracted: records.length, tableName: targetTable, columns };
  }
}

/**
 * read-excel-file marks error cells by prefixing the Excel error code, so
 * `#DIV/0!` arrives as `#ERROR_#DIV/0!`. Strip it so the staged value stays
 * the bare Excel code, matching what the exceljs-based adapter emitted before
 * DAG-207 and what a user sees in the spreadsheet.
 */
const ERROR_CELL_PREFIX = "#ERROR_";

/**
 * Render a cell value as a flat string — the conventional "displayed text"
 * view. read-excel-file hands back primitives, `Date`s, formula results
 * already resolved to their cached value, rich text already concatenated, and
 * hyperlinks already reduced to their visible text, so this stays thin.
 */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    return v.startsWith(ERROR_CELL_PREFIX) ? v.slice(ERROR_CELL_PREFIX.length) : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return stringifyValue(v);
}
