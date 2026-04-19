/**
 * Excel (XLSX) source adapter. Uses SheetJS to convert the selected sheet
 * to a CSV blob, then re-parses it with csv-parse — all columns VARCHAR.
 *
 * Phase 3 prep Change 1: `targetTable` defaults to 'stg_raw' at this layer.
 */

import { readFile as readFileAsync } from 'node:fs/promises';

import { parse } from 'csv-parse/sync';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';

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

    const workbook = xlsxRead(buf, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;
    if (sheetNames.length === 0) {
      throw new SourceError(`xlsx: workbook "${config.file}" has no sheets`);
    }

    if (sheetNames.length > 1 && config.sheet === undefined) {
      logger.warn(
        { file: config.file, sheets: sheetNames, using: sheetNames[0] },
        'xlsx: multiple sheets found and `source.sheet` is unset — using first sheet',
      );
    }

    const sheetKey =
      config.sheet === undefined
        ? sheetNames[0]!
        : typeof config.sheet === 'number'
          ? sheetNames[config.sheet]
          : config.sheet;

    if (!sheetKey || !workbook.Sheets[sheetKey]) {
      throw new SourceError(`xlsx: sheet "${String(config.sheet)}" not found in ${config.file}`);
    }

    const csvText = xlsxUtils.sheet_to_csv(workbook.Sheets[sheetKey], { strip: false });
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    }) as Record<string, unknown>[];

    if (records.length === 0) {
      throw new SourceError(`xlsx: sheet "${sheetKey}" is empty`);
    }

    const first = records[0]!;
    const columns: ColumnMeta[] = Object.keys(first).map((n) => ({
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
