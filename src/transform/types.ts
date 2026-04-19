/**
 * Transform engine result. Phase 4 runner emits a trivial pass-through count;
 * Phase 6 introduces the full engine with cleanse/expression/lookup.
 */

export interface TransformResult {
  rowsIn: number;
  rowsOut: number;
  rowsFailed: number;
}
