// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

/**
 * Merge strategy: COALESCE
 *
 * For each field, selects the first non-null value across sources,
 * respecting the priority order (lower priority = checked first).
 * Whitespace-only values are treated as blank and skipped.
 *
 * Example:
 *   Source A (priority 1): STYLE_DESC = null
 *   Source B (priority 2): STYLE_DESC = "FromExcel"
 *   → Result: STYLE_DESC = "FromExcel"
 *
 * Unmatched rows (present in only one source) are included by default.
 */

import type { MergeStrategyPlugin } from '../types.js';
import type { StagingStore } from '../../staging/index.js';
import { quoteIdent } from '../../staging/index.js';
import { logger } from '../../utils/logger.js';

import {
  buildJoinedTableSql,
  buildMergedTableSql,
  buildPresentCountExpr,
  normalizeKeyColumns,
  type BuildMergeContext,
} from '../sql-builder.js';
import { buildConflictLog } from '../conflict-log.js';
import type { MergeSourceMeta, MergeResult } from '../types.js';
import type { MergeConfig } from '../../config/types.js';
import { ConfigError, PipelineError } from '../../utils/errors.js';

export const coalesceStrategy: MergeStrategyPlugin = {
  id: 'coalesce',
  description: 'First non-null value wins. Coalesces each field across sources in priority order; includes unmatched rows by default.',

  async merge(
    store: StagingStore,
    rawSources: MergeSourceMeta[],
    config: MergeConfig,
  ): Promise<MergeResult> {
    if (rawSources.length < 2) {
      throw new ConfigError('merge requires at least 2 sources');
    }

    const sources = [...rawSources].sort((a, b) => a.priority - b.priority);
    const keyColumns = normalizeKeyColumns(config.key);

    const sourceColumns: Record<string, string[]> = {};
    for (const source of sources) {
      sourceColumns[source.id] = await store.columnNames(source.tableName);
      for (const key of keyColumns) {
        if (!sourceColumns[source.id]!.includes(key)) {
          throw new ConfigError(
            `merge key column '${key}' is missing from source '${source.id}' table '${source.tableName}'`,
          );
        }
      }
    }

    const context: BuildMergeContext = { sources, keyColumns, sourceColumns };

    // Build the joined table (FULL OUTER JOIN on keys)
    const joinedTable = 'stg_merge_joined';
    await store.query(buildJoinedTableSql(joinedTable, context));

    // Check for unmatched rows and handle per config
    const presentCountExpr = buildPresentCountExpr(sources, keyColumns);
    const unmatchedRows = await store.query<{ n: number | bigint }>(
      `SELECT count(*) AS n FROM ${quoteIdent(joinedTable)} WHERE (${presentCountExpr}) = 1`,
    );
    const unmatched = Number(unmatchedRows[0]?.n ?? 0);

    if (config.onUnmatched === 'error' && unmatched > 0) {
      throw new PipelineError(
        `merge halted: ${unmatched} unmatched row(s) encountered with onUnmatched=error`,
      );
    }
    if (config.onUnmatched === 'warn' && unmatched > 0) {
      logger.warn({ unmatched }, 'merge: unmatched rows present');
    }

    // Build output columns in order: keys first, then all non-key columns
    const seen = new Set<string>();
    const outputColumns: string[] = [];
    for (const key of keyColumns) {
      if (!seen.has(key)) {
        seen.add(key);
        outputColumns.push(key);
      }
    }
    for (const source of sources) {
      for (const col of sourceColumns[source.id] ?? []) {
        if (!seen.has(col)) {
          seen.add(col);
          outputColumns.push(col);
        }
      }
    }

    // Merge: coalesce picks first non-null value respecting priority
    const mergedTable = 'stg_merged';
    await store.query(
      buildMergedTableSql(mergedTable, joinedTable, context, config, outputColumns),
    );

    const rowsMerged = await store.rowCount(mergedTable);
    const conflictLog = await buildConflictLog(
      store,
      joinedTable,
      context,
      config,
      outputColumns,
      'stg_merge_conflicts',
    );

    logger.info(
      {
        strategy: 'coalesce',
        sources: sources.length,
        rowsMerged,
        conflicts: conflictLog.count,
        unmatched,
      },
      'merge: complete',
    );

    return {
      rowsMerged,
      conflicts: conflictLog.count,
      unmatched,
      tableName: mergedTable,
    };
  },
};
