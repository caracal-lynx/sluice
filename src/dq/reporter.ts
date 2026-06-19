// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * DQ reporter — writes rejection CSV + summary JSON.
 * Pure file I/O; no DuckDB access.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { stringify } from "csv-stringify/sync";

import { stringifyValue } from "../utils/stringify.js";
import type { RuleViolation } from "./rules/types.js";
import type { DQSummary } from "./types.js";

const REJECTION_CSV_HEADER = [
  "row_index",
  "field",
  "value",
  "rule",
  "severity",
  "message",
] as const;

export async function writeRejectionCsv(
  outputPath: string,
  violations: RuleViolation[],
): Promise<void> {
  const rows = violations.map((v) => [
    String(v.rowIndex),
    v.field,
    v.value === null || v.value === undefined ? "" : stringifyValue(v.value),
    v.rule,
    v.severity,
    v.message,
  ]);
  const csv = stringify([[...REJECTION_CSV_HEADER], ...rows]);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, csv, "utf-8");
}

export async function writeSummaryJson(outputPath: string, summary: DQSummary): Promise<void> {
  // Strip the internal `rejectedRowIndices` field from the serialised JSON —
  // CLAUDE.md's published summary shape does not include it, and the list
  // could be huge for large datasets. It stays on the in-memory summary for
  // the runner to consume when filtering rejected rows pre-transform.
  const { rejectedRowIndices: _omit, ...publicShape } = summary as DQSummary & {
    rejectedRowIndices?: number[];
  };
  void _omit;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(publicShape, null, 2)}\n`, "utf-8");
}
