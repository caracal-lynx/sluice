/**
 * Source adapter interface.
 *
 * Phase 3 prep Change 1 baked in:
 *   - ExtractResult.tableName is `string` (was literal 'stg_raw')
 *   - extract() accepts an optional `targetTable` parameter
 * This keeps the interface stable when MultiSourcePipelineRunner (Phase 3)
 * extracts into `stg_raw_{sourceId}` tables.
 */

import type { RunConfig, SourceConfig } from '../../config/types.js';
import type { ColumnMeta, StagingStore } from '../../staging/index.js';

export interface SourceAdapter {
  readonly id: string;

  connect(config: SourceConfig): Promise<void>;

  extract(
    config: SourceConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
    targetTable?: string,
  ): Promise<ExtractResult>;

  disconnect(): Promise<void>;
}

export interface ExtractResult {
  rowsExtracted: number;
  /** Caller-supplied (or adapter default). Single-source pipelines use 'stg_raw'. */
  tableName: string;
  columns: ColumnMeta[];
}

export type { ColumnMeta } from '../../staging/index.js';
