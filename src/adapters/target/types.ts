// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

import type { RunConfig, TargetConfig } from '../../config/types.js';
import type { StagingStore } from '../../staging/index.js';

export interface TargetAdapter {
  readonly id: string;

  connect(config: TargetConfig): Promise<void>;

  load(
    config: TargetConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
  ): Promise<LoadResult>;

  disconnect(): Promise<void>;
}

export interface LoadResult {
  rowsLoaded: number;
  rowsFailed: number;
  /** Set for file-based targets (csv, ifs, bluecherry). */
  outputPath?: string;
}
