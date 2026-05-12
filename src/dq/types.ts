// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * DQ summary shape shared between the engine, reporter, and runner.
 *
 * Phase 4: runner emits a stub summary with zero violations.
 * Phase 5: DQEngine and reporter populate this from real rule evaluations.
 */

export interface ViolationCounts {
  critical: number;
  warning: number;
  info: number;
}

export interface DQSummary {
  pipeline: string;
  runAt: string;
  rowsChecked: number;
  rowsPassed: number;
  rowsRejected: number;
  violations: ViolationCounts;
  byField: Record<string, ViolationCounts>;
  /** Filesystem path of the written summary JSON; empty string when not written. */
  reportPath: string;
  /**
   * Row indices (0-based) that carry at least one `critical` violation.
   * Consumed by the transform engine to exclude rejected rows from stg_transformed.
   * Stripped before the summary is serialised to disk.
   */
  rejectedRowIndices?: number[];
}
