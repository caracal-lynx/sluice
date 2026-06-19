// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import type { StagingStore } from "../staging/store.js";
import type { MergeConfig } from "../config/types.js";

export interface MergeSourceMeta {
  id: string;
  priority: number;
  tableName: string; // e.g. 'stg_raw_sql_server'
}

export interface MergeResult {
  rowsMerged: number;
  conflicts: number; // fields where two non-null values disagreed
  unmatched: number; // records present in only one source
  tableName: "stg_merged";
}

export interface MergeStrategyPlugin {
  readonly id: string; // matches MergeSchema.strategy value
  readonly description?: string; // human-readable strategy description (optional per phase3 prep spec)

  /**
   * Merges N source staging tables into stg_merged.
   * Sources are passed in priority order (priority 1 first).
   * The implementation is responsible for creating stg_merged in the store.
   */
  merge(store: StagingStore, sources: MergeSourceMeta[], config: MergeConfig): Promise<MergeResult>;
}
