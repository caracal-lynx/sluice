// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * PrepEngine — applies a list of PrepRule[] to a staging table in place.
 *
 * Algorithm per firing:
 *   1. Filter rules by firing point (pre-merge sourceId match vs post-merge / single-source).
 *   2. Validate every rule's `field` exists in the target table.
 *   3. SELECT all rows.
 *   4. For each row, walk rules top-to-bottom — later rules see earlier
 *      mutations. Per rule:
 *        a. Evaluate `when` if set; falsy → skip rule for that row (rowsSkipped++).
 *        b. Apply cleanse / expression / lookup (exactly one).
 *        c. Lookup miss obeys `onMiss`: keep | null | error. `error` always halts,
 *           ignoring `run.onError`.
 *        d. Runtime errors in cleanse / expression / when respect `run.onError`:
 *           `continue` → rowsFailed++ + WARN log; `stop` → throw PrepError.
 *        e. If the value actually changed, write back and rowsChanged++.
 *   5. DROP + CREATE OR REPLACE the table as all-VARCHAR; insertBatch the
 *      mutated rows. Matches how TransformEngine writes stg_transformed.
 *
 * See docs/PHASE-12-prep-phase-spec.md for the full spec.
 */

import type { PrepConfig, PrepRule, RunConfig } from "../config/types.js";
import { quoteIdent, type ColumnMeta, type StagingStore } from "../staging/index.js";
import { applyCleanse } from "../transform/cleanse.js";
import type { ExpressionEvaluator } from "../transform/expression.js";
import { PrepError } from "../utils/errors.js";
import { stringifyValue } from "../utils/stringify.js";
import type { Logger } from "pino";
import type { PrepLookupResolver } from "./lookup.js";
import type { PrepFiringResult, PrepRuleResult } from "./types.js";

export class PrepEngine {
  constructor(
    private readonly store: StagingStore,
    private readonly resolver: PrepLookupResolver,
    private readonly evaluator: ExpressionEvaluator,
    private readonly logger: Logger,
  ) {}

  /**
   * Apply prep rules to a single staging table.
   *
   * @param table     Staging table name to mutate in place.
   * @param prep      Parsed PrepSchema config.
   * @param sourceId  For multi-source pre-merge firings, the current source id.
   *                  `undefined` for single-source runs and post-merge firings.
   * @param runCfg    Run config (batchSize, onError).
   */
  async run(
    table: string,
    prep: PrepConfig,
    sourceId: string | undefined,
    runCfg: RunConfig,
  ): Promise<PrepFiringResult> {
    const applicable = prep.rules.filter((r) =>
      sourceId === undefined ? r.sourceId === undefined : r.sourceId === sourceId,
    );

    const firingMeta = { table, sourceId: sourceId ?? null } as const;

    if (applicable.length === 0) {
      this.logger.debug(firingMeta, "prep: no applicable rules for this firing");
      return { table, sourceId: sourceId ?? null, rulesApplied: 0, rules: [] };
    }

    const existingColumns = await this.store.columnNames(table);
    const existingSet = new Set(existingColumns);
    for (const rule of applicable) {
      if (!existingSet.has(rule.field)) {
        throw new PrepError(
          `prep rule references unknown column "${rule.field}" in table "${table}"`,
        );
      }
    }

    const rows = await this.store.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdent(table)}`,
    );

    const ruleResults: PrepRuleResult[] = applicable.map((r) => ({
      field: r.field,
      op: describeOp(r),
      rowsChanged: 0,
      rowsSkipped: 0,
      rowsFailed: 0,
    }));

    for (const [rowIdx, row] of rows.entries()) {
      for (let ri = 0; ri < applicable.length; ri++) {
        const rule = applicable[ri];
        const result = ruleResults[ri];
        if (rule === undefined || result === undefined) continue;
        const ruleApplied = this.applyRule(rule, row, rowIdx, runCfg, result);
        if (!ruleApplied) continue;
      }
    }

    // Rebuild the table from the mutated rows. All-VARCHAR matches the rest
    // of the pipeline's lingua franca (TransformEngine also writes VARCHAR).
    const columns: ColumnMeta[] = existingColumns.map((name) => ({
      name,
      duckDbType: "VARCHAR",
    }));
    await this.store.dropTable(table);
    await this.store.createTable(table, columns);

    for (let i = 0; i < rows.length; i += runCfg.batchSize) {
      const batch = rows.slice(i, i + runCfg.batchSize);
      await this.store.insertBatch(table, batch);
    }

    const totalChanged = ruleResults.reduce((n, r) => n + r.rowsChanged, 0);
    const totalSkipped = ruleResults.reduce((n, r) => n + r.rowsSkipped, 0);
    const totalFailed = ruleResults.reduce((n, r) => n + r.rowsFailed, 0);
    this.logger.info(
      {
        ...firingMeta,
        rules: applicable.length,
        rowsScanned: rows.length,
        rowsChanged: totalChanged,
        rowsSkipped: totalSkipped,
        rowsFailed: totalFailed,
      },
      "prep: firing complete",
    );

    return {
      table,
      sourceId: sourceId ?? null,
      rulesApplied: applicable.length,
      rules: ruleResults,
    };
  }

  /**
   * Apply a single rule to a single row in place.
   * Returns true if execution should proceed to the next rule for this row,
   * false if the row should be left to the next iteration of the outer loop.
   * (We don't actually exit the outer loop on `false`; the boolean is reserved
   * for future use and currently always returns true.)
   */
  private applyRule(
    rule: PrepRule,
    row: Record<string, unknown>,
    rowIdx: number,
    runCfg: RunConfig,
    result: PrepRuleResult,
  ): boolean {
    // ── `when` predicate ────────────────────────────────────────────────
    if (rule.when) {
      try {
        const truthy = Boolean(this.evaluator.evaluate(rule.when, row));
        if (!truthy) {
          result.rowsSkipped++;
          return true;
        }
      } catch (err) {
        return this.handleRowError(err, rule, rowIdx, runCfg, result, "when");
      }
    }

    const oldValue = row[rule.field];

    // ── Apply op (exactly one of cleanse / expression / lookup) ────────
    let newValue: unknown;
    if (rule.cleanse !== undefined) {
      try {
        newValue = applyCleanse(oldValue, rule.cleanse);
      } catch (err) {
        return this.handleRowError(err, rule, rowIdx, runCfg, result, "cleanse");
      }
    } else if (rule.expression !== undefined) {
      try {
        newValue = this.evaluator.evaluate(rule.expression, row);
      } catch (err) {
        return this.handleRowError(err, rule, rowIdx, runCfg, result, "expression");
      }
    } else if (rule.lookup !== undefined) {
      // Unknown lookup names throw PrepError unconditionally — they're a
      // config issue, not a row-level error.
      const resolved = this.resolver.resolve(rule.lookup, oldValue);
      if (resolved === undefined) {
        if (rule.onMiss === "error") {
          throw new PrepError(
            `prep lookup "${rule.lookup}" missed value ${formatValue(oldValue)} for field "${rule.field}" (onMiss: error)`,
          );
        }
        newValue = rule.onMiss === "null" ? null : oldValue;
      } else {
        newValue = resolved;
      }
    } else {
      // Unreachable — refute via Zod refine at parse time.
      return true;
    }

    if (newValue !== oldValue) {
      row[rule.field] = newValue;
      result.rowsChanged++;
    }
    return true;
  }

  /**
   * Centralised handler for runtime errors thrown by `when`, cleanse, or
   * expression ops. Honours `run.onError`. Does NOT apply to `onMiss: error`,
   * which always halts.
   */
  private handleRowError(
    err: unknown,
    rule: PrepRule,
    rowIdx: number,
    runCfg: RunConfig,
    result: PrepRuleResult,
    phase: "when" | "cleanse" | "expression",
  ): boolean {
    if (runCfg.onError === "stop") {
      if (err instanceof PrepError) throw err;
      throw new PrepError(
        `prep ${phase} failed on field "${rule.field}" at row ${rowIdx}: ${formatErr(err)}`,
        err,
      );
    }
    result.rowsFailed++;
    this.logger.warn(
      {
        field: rule.field,
        rowIndex: rowIdx,
        phase,
        err: err instanceof Error ? err.message : String(err),
      },
      "prep: row error (onError: continue)",
    );
    return true;
  }
}

function describeOp(rule: PrepRule): string {
  if (rule.cleanse !== undefined) return `cleanse:${rule.cleanse}`;
  if (rule.expression !== undefined) return "expression";
  if (rule.lookup !== undefined) return `lookup:${rule.lookup}`;
  return "unknown";
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return JSON.stringify(v);
  return stringifyValue(v);
}

function formatErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
