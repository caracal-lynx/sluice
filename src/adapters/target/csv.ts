/**
 * Generic CSV target adapter.
 *
 * Reads `stg_transformed` via StagingStore.exportToCsv (DuckDB COPY).
 * Honours target.includeHeader (default true), delimiter, nullValue.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { RunConfig, TargetConfig } from '../../config/types.js';
import type { StagingStore } from '../../staging/index.js';
import { LoadError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { LoadResult, TargetAdapter } from './types.js';

const STAGING_TABLE = 'stg_transformed';

export class CsvTargetAdapter implements TargetAdapter {
  readonly id = 'csv';

  async connect(_config: TargetConfig): Promise<void> {
    // No persistent connection needed.
  }

  async disconnect(): Promise<void> {
    // Nothing to release.
  }

  async load(
    config: TargetConfig,
    store: StagingStore,
    _runConfig: RunConfig,
    onProgress: (rows: number) => void,
  ): Promise<LoadResult> {
    if (!config.output) {
      throw new LoadError('csv target requires `output`');
    }
    const outputPath = path.resolve(config.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const rowsLoaded = await store.rowCount(STAGING_TABLE);
    const includeHeader = config.includeHeader ?? true;

    await store.exportToCsv(STAGING_TABLE, outputPath, {
      delimiter: config.delimiter,
      header: includeHeader,
      nullValue: config.nullValue,
    });

    onProgress(rowsLoaded);
    logger.debug({ outputPath, rowsLoaded }, 'csv target: load complete');

    return { rowsLoaded, rowsFailed: 0, outputPath };
  }
}
