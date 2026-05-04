// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

/**
 * CSV source adapter.
 *
 * - All columns inferred as VARCHAR.
 * - UTF-8 BOM stripped automatically (`bom: true`).
 * - Supports simple filename globs (`./data/export-*.csv`) — wildcard must
 *   be in the filename, not the directory.
 * - Glob-matched files are concatenated into a single staging table; the
 *   first file's columns define the schema.
 * - Rows are streamed through csv-parse and flushed to the staging store
 *   in batches of `runConfig.batchSize`.
 *
 * `targetTable` defaults to 'stg_raw' here so single-source callers don't
 * have to pass it; `MultiSourcePipelineRunner` overrides per source.
 */

import { createReadStream, readdirSync } from 'node:fs';
import * as path from 'node:path';

import { parse } from 'csv-parse';

import type { RunConfig, SourceConfig } from '../../config/types.js';
import type { ColumnMeta, StagingStore } from '../../staging/index.js';
import { SourceError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { ExtractResult, SourceAdapter } from './types.js';

function resolveGlob(pattern: string): string[] {
  if (!pattern.includes('*')) return [pattern];
  const parsed = path.parse(pattern);
  if (parsed.dir.includes('*')) {
    throw new SourceError(`glob wildcards are only supported in the filename: "${pattern}"`);
  }
  const re = new RegExp(
    '^' + parsed.base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  const searchDir = parsed.dir === '' ? '.' : parsed.dir;
  let entries: string[];
  try {
    entries = readdirSync(searchDir);
  } catch (err) {
    throw new SourceError(
      `could not read directory "${searchDir}" for glob "${pattern}"`,
      err,
    );
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

export class CsvSourceAdapter implements SourceAdapter {
  readonly id = 'csv';

  async connect(_config: SourceConfig): Promise<void> {
    // CSV is file-based; no persistent connection to establish.
  }

  async disconnect(): Promise<void> {
    // Nothing to release.
  }

  async extract(
    config: SourceConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
    targetTable = 'stg_raw',
  ): Promise<ExtractResult> {
    if (!config.file) {
      throw new SourceError('csv source requires `file`');
    }
    const files = resolveGlob(config.file);
    logger.debug({ files, targetTable }, 'csv: resolved input files');

    let columns: ColumnMeta[] | null = null;
    let totalRows = 0;
    const batchSize = runConfig.batchSize;

    for (const file of files) {
      const parser = createReadStream(file).pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          bom: true,
          delimiter: config.delimiter,
        }),
      );
      const batch: Record<string, unknown>[] = [];

      try {
        for await (const record of parser) {
          const row = record as Record<string, unknown>;
          if (!columns) {
            const names = Object.keys(row);
            if (names.length === 0) {
              throw new SourceError(`csv file "${file}" has no columns`);
            }
            columns = names.map((n) => ({ name: n, duckDbType: 'VARCHAR' }));
            await store.createTable(targetTable, columns);
          }
          batch.push(row);
          if (batch.length >= batchSize) {
            await store.insertBatch(targetTable, batch);
            totalRows += batch.length;
            batch.length = 0;
            onProgress(totalRows);
          }
        }
        if (batch.length > 0) {
          await store.insertBatch(targetTable, batch);
          totalRows += batch.length;
          onProgress(totalRows);
        }
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `csv extract failed for "${file}": ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    }

    if (!columns) {
      throw new SourceError(`csv extract produced no data for "${config.file}"`);
    }

    return { rowsExtracted: totalRows, tableName: targetTable, columns };
  }
}
