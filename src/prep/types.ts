// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Prep phase result types.
 */

export interface PrepRuleResult {
  /** Column the rule targeted. */
  field: string;
  /** Op kind plus identifying detail, e.g. `cleanse:padEnd:10:0`, `expression`, `lookup:hcCodeFixups`. */
  op: string;
  /** Rows where the new value differed from the old. */
  rowsChanged: number;
  /** Rows skipped by the `when` predicate. */
  rowsSkipped: number;
  /** Rows where the rule errored (only > 0 when run.onError === 'continue'). */
  rowsFailed: number;
}

export interface PrepFiringResult {
  /** Staging table the firing ran against. */
  table: string;
  /** Source id for pre-merge firings; null for single-source and post-merge. */
  sourceId: string | null;
  /** Number of rules that actually applied at this firing. */
  rulesApplied: number;
  /** Per-rule outcome. */
  rules: PrepRuleResult[];
}

export interface PrepSummary {
  /** Pipeline name. */
  pipeline: string;
  /** ISO timestamp of the prep phase start. */
  runAt: string;
  /** One entry per firing (one for single-source; up to N + 1 for multi-source). */
  firings: PrepFiringResult[];
}
