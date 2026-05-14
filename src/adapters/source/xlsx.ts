// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Excel (XLSX) source adapter. Reads the workbook with ExcelJS, picks the
 * named/indexed sheet (or warns + uses the first), and emits each row as a
 * Record<string, string> keyed by the header row. All columns stage as
 * VARCHAR — type coercion happens in transform, not here.
 *
 * `targetTable` defaults to 'stg_raw'.
 */

import { readFile as readFileAsync } from 'node:fs/promises';

import ExcelJS from 'exceljs';

import type { RunConfig, SourceConfig } from '../../config/types.js';
import type { ColumnMeta, StagingStore } from '../../staging/index.js';
import { SourceError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { ExtractResult, SourceAdapter } from './types.js';

export class XlsxSourceAdapter implements SourceAdapter {
  readonly id = 'xlsx';

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
    targetTable = 'stg_raw',
  ): Promise<ExtractResult> {
    if (!config.file) {
      throw new SourceError('xlsx source requires `file`');
    }

    let buf: Buffer;
    try {
      buf = await readFileAsync(config.file);
    } catch (err) {
      throw new SourceError(
        `xlsx: failed to read "${config.file}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs's bundled types predate Node's generic `Buffer<T>` (introduced
      // when ArrayBuffer became resizable). TS can't reconcile our runtime
      // `Buffer<ArrayBufferLike>` with exceljs's `Buffer` reference in either
      // direction. Same byte layout at runtime — accept the gap.
      // @ts-expect-error exceljs Buffer typing predates Node's generic Buffer<T>
      await workbook.xlsx.load(buf);
    } catch (err) {
      throw new SourceError(
        `xlsx: failed to parse "${config.file}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    const worksheets = workbook.worksheets;
    if (worksheets.length === 0) {
      throw new SourceError(`xlsx: workbook "${config.file}" has no sheets`);
    }

    if (worksheets.length > 1 && config.sheet === undefined) {
      logger.warn(
        {
          file: config.file,
          sheets: worksheets.map((w) => w.name),
          using: worksheets[0]!.name,
        },
        'xlsx: multiple sheets found and `source.sheet` is unset — using first sheet',
      );
    }

    const worksheet =
      config.sheet === undefined
        ? worksheets[0]
        : typeof config.sheet === 'number'
          ? worksheets[config.sheet]
          : workbook.getWorksheet(config.sheet);

    if (!worksheet) {
      throw new SourceError(`xlsx: sheet "${String(config.sheet)}" not found in ${config.file}`);
    }

    // Headers from row 1
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber - 1] = cellToString(cell).trim();
    });
    // Trim trailing empties
    while (headers.length > 0 && !headers[headers.length - 1]) {
      headers.pop();
    }
    if (headers.length === 0) {
      throw new SourceError(`xlsx: sheet "${worksheet.name}" has no header row`);
    }

    // Data rows (start from row 2)
    const records: Record<string, string>[] = [];
    for (let r = 2; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      if (!row.hasValues) continue;
      const record: Record<string, string> = {};
      for (let c = 1; c <= headers.length; c++) {
        record[headers[c - 1]!] = cellToString(row.getCell(c));
      }
      records.push(record);
    }

    if (records.length === 0) {
      throw new SourceError(`xlsx: sheet "${worksheet.name}" is empty`);
    }

    const columns: ColumnMeta[] = headers.map((n) => ({
      name: n,
      duckDbType: 'VARCHAR',
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
 * Render an ExcelJS cell value as a flat string. Mirrors the conventional
 * "displayed text" view: numbers/booleans coerced, dates ISO-formatted,
 * formulas resolved to their cached result, rich text concatenated,
 * hyperlinks rendered as their visible text.
 */
function cellToString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    // Formula: { formula, result }
    if ('result' in v && v.result !== undefined) {
      const r = v.result;
      if (r == null) return '';
      if (typeof r === 'object' && 'error' in r) return `#${(r as { error: string }).error}`;
      if (r instanceof Date) return r.toISOString();
      return String(r);
    }
    // Rich text: { richText: [{ text }] }
    if ('richText' in v && Array.isArray((v as { richText?: unknown }).richText)) {
      return (v as { richText: Array<{ text?: string }> }).richText
        .map((part) => part.text ?? '')
        .join('');
    }
    // Hyperlink: { text, hyperlink }
    if ('text' in v) {
      return String((v as { text: unknown }).text ?? '');
    }
    // Error: { error: '#NULL!' }
    if ('error' in v) {
      return `#${(v as { error: string }).error}`;
    }
  }
  return String(v);
}
