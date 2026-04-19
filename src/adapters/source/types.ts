/**
 * Source adapter interface.
 *
 * `ExtractResult.tableName` is caller-supplied; single-source pipelines use
 * `'stg_raw'`, and `MultiSourcePipelineRunner` passes `'stg_raw_{sourceId}'`
 * via the optional `targetTable` parameter on `extract()`.
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
