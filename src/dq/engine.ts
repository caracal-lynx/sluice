// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * DQ engine.
 *
 * `run()` takes `tableName` so callers can point the engine at `stg_raw`,
 * `stg_merged`, or `stg_raw_{sourceId}` — the engine itself is table-agnostic.
 *
 * `DqRule.sourceId` is parsed by the schema but not consulted here. The
 * MultiSourcePipelineRunner filters rules by `sourceId` before invoking
 * this engine.
 */

import * as path from "node:path";

import type { Pipeline } from "../config/types.js";
import type { RuleRegistry } from "../plugins/registry.js";
import { StagingStore, quoteIdent } from "../staging/index.js";
import { ConfigError } from "../utils/errors.js";
import { stringifyValue } from "../utils/stringify.js";
import { writeRejectionCsv, writeSummaryJson } from "./reporter.js";
import { BUILT_IN_RULES } from "./rules/index.js";
import type { Rule, RuleViolation } from "./rules/types.js";
import type { DQSummary, ViolationCounts } from "./types.js";

export class DQEngine {
  constructor(private readonly ruleRegistry?: RuleRegistry) {}

  async run(
    config: Pipeline,
    store: StagingStore,
    tableName = "stg_raw",
    onProgress?: (rows: number) => void,
  ): Promise<DQSummary> {
    const rules = config.dq.rules;

    // Short-circuit when there are no rules: still write a summary so callers
    // have a consistent report-path contract.
    const rows = await store.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdent(tableName)}`,
    );

    // ── Pre-pass: compute duplicate sets for every field carrying a `unique` check ──
    const duplicatesByField = new Map<string, Set<string>>();
    for (const rule of rules) {
      const hasUnique = rule.checks.some((c) => c.type === "unique");
      if (!hasUnique || duplicatesByField.has(rule.field)) continue;
      const qField = quoteIdent(rule.field);
      const dupRows = await store.query<{ v: unknown; n: unknown }>(
        `SELECT ${qField} AS v, count(*) AS n FROM ${quoteIdent(tableName)} WHERE ${qField} IS NOT NULL GROUP BY v HAVING count(*) > 1`,
      );
      duplicatesByField.set(rule.field, new Set(dupRows.map((r) => String(r.v))));
    }

    // ── Main pass: validate every (row, rule, check) combination ──
    const violations: RuleViolation[] = [];
    const progressEvery = 500;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      if (onProgress && rowIndex > 0 && rowIndex % progressEvery === 0) {
        onProgress(rowIndex);
      }
      const row = rows[rowIndex];
      for (const rule of rules) {
        const value = row[rule.field];
        for (const check of rule.checks) {
          if (check.type === "unique") {
            const dups = duplicatesByField.get(rule.field);
            if (
              value !== null &&
              value !== undefined &&
              value !== "" &&
              dups?.has(stringifyValue(value))
            ) {
              violations.push({
                field: rule.field,
                rowIndex,
                value,
                rule: "unique",
                severity: check.severity,
                message:
                  check.message ?? `${rule.field} value "${stringifyValue(value)}" is not unique`,
              });
            }
            continue;
          }
          const impl: Rule | undefined =
            (BUILT_IN_RULES as Record<string, Rule>)[check.type] ??
            this.ruleRegistry?.get(check.type);
          if (impl === undefined) {
            throw new ConfigError(
              `Unknown DQ rule type "${String(check.type)}". ` +
                `Built-in types: ${Object.keys(BUILT_IN_RULES).join(", ")}`,
            );
          }
          const violation = impl.validate(value, check, rowIndex, rule.field);
          if (violation) violations.push(violation);
        }
      }
    }

    // ── Aggregate ──
    const counts: ViolationCounts = { critical: 0, warning: 0, info: 0 };
    const byField: Record<string, ViolationCounts> = {};
    const criticalRows = new Set<number>();
    for (const v of violations) {
      counts[v.severity]++;
      if (v.severity === "critical") criticalRows.add(v.rowIndex);
      const bf = (byField[v.field] ??= { critical: 0, warning: 0, info: 0 });
      bf[v.severity]++;
    }
    const rowsChecked = rows.length;
    const rowsRejected = criticalRows.size;
    const rowsPassed = rowsChecked - rowsRejected;
    if (onProgress) onProgress(rowsChecked);

    // ── Write reports ──
    const outputDir = path.resolve(config.run.outputDir);
    const rejectionFile =
      config.dq.rejectionFile ?? path.join(outputDir, `${config.pipeline.name}-rejected.csv`);
    const summaryFile = path.join(outputDir, `${config.pipeline.name}-dq-summary.json`);

    await writeRejectionCsv(rejectionFile, violations);

    const summary: DQSummary = {
      pipeline: config.pipeline.name,
      runAt: new Date().toISOString(),
      rowsChecked,
      rowsPassed,
      rowsRejected,
      violations: counts,
      byField,
      reportPath: summaryFile,
      rejectedRowIndices: [...criticalRows].sort((a, b) => a - b),
    };
    await writeSummaryJson(summaryFile, summary);

    return summary;
  }
}
