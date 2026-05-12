// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Merge strategy: INTERSECT
 *
 * Only includes rows that are present in ALL sources.
 * Any row missing from even one source is excluded.
 * For each field, uses coalesce semantics (first non-null value respecting priority).
 *
 * Example:
 *   Source A: {ID: "A", ID: "B"}
 *   Source B: {ID: "B", ID: "C"}
 *   → Result: only {ID: "B"} (present in both)
 *
 * Unmatched rows are always excluded regardless of config.onUnmatched.
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
import { ConfigError } from '../../utils/errors.js';

export const intersectStrategy: MergeStrategyPlugin = {
  id: 'intersect',
  description: 'Only common rows. Includes only rows present in ALL sources; useful for intersection and reconciliation scenarios.',

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

    // Count unmatched rows (informational only; intersect always excludes them)
    const presentCountExpr = buildPresentCountExpr(sources, keyColumns);
    const unmatchedRows = await store.query<{ n: number | bigint }>(
      `SELECT count(*) AS n FROM ${quoteIdent(joinedTable)} WHERE (${presentCountExpr}) < ${sources.length}`,
    );
    const unmatched = Number(unmatchedRows[0]?.n ?? 0);

    if (unmatched > 0) {
      logger.info({ unmatched }, 'merge: intersect strategy excludes unmatched rows');
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

    // Merge: intersect only includes rows present in all sources, coalesce field values
    const mergedTable = 'stg_merged';
    const cfgOverride: MergeConfig = { ...config, strategy: 'intersect' };
    await store.query(
      buildMergedTableSql(mergedTable, joinedTable, context, cfgOverride, outputColumns),
    );

    const rowsMerged = await store.rowCount(mergedTable);
    const conflictLog = await buildConflictLog(
      store,
      joinedTable,
      context,
      cfgOverride,
      outputColumns,
      'stg_merge_conflicts',
    );

    logger.info(
      {
        strategy: 'intersect',
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
