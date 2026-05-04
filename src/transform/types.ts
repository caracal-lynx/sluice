// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

/**
 * Transform engine result. Phase 4 runner emits a trivial pass-through count;
 * Phase 6 introduces the full engine with cleanse/expression/lookup.
 */

export interface TransformResult {
  rowsIn: number;
  rowsOut: number;
  rowsFailed: number;
}
