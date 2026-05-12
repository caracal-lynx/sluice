// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import type { MergeConfig } from '../config/types.js';
import { quoteIdent } from '../staging/index.js';

import type { MergeSourceMeta } from './types.js';

export interface BuildMergeContext {
  sources: MergeSourceMeta[];
  keyColumns: string[];
  sourceColumns: Record<string, string[]>;
}

export function normalizeKeyColumns(key: MergeConfig['key']): string[] {
  return Array.isArray(key) ? key : [key];
}

export function prefixedColumn(sourceId: string, column: string): string {
  return `${sourceId}__${column}`;
}

export function sourceHasColumn(
  sourceColumns: Record<string, string[]>,
  sourceId: string,
  column: string,
): boolean {
  return (sourceColumns[sourceId] ?? []).includes(column);
}

export function buildPresenceExpr(sourceId: string, keyColumns: string[]): string {
  const checks = keyColumns
    .map((k) => `${quoteIdent(prefixedColumn(sourceId, k))} IS NOT NULL`)
    .join(' AND ');
  return `CASE WHEN ${checks} THEN 1 ELSE 0 END`;
}

export function buildPresentCountExpr(sources: MergeSourceMeta[], keyColumns: string[]): string {
  return sources.map((s) => `(${buildPresenceExpr(s.id, keyColumns)})`).join(' + ');
}

export function buildCoalescedKeyExpr(sources: MergeSourceMeta[], key: string): string {
  const refs = sources.map((s) => `${quoteIdent(prefixedColumn(s.id, key))}`);
  return `COALESCE(${refs.join(', ')})`;
}

export function buildConflictPredicate(columnRefs: string[]): string {
  const normalized = columnRefs.map((r) => `NULLIF(TRIM(CAST(${r} AS VARCHAR)), '')`);
  const pairs: string[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const left = normalized[i]!;
      const right = normalized[j]!;
      pairs.push(`(${left} IS NOT NULL AND ${right} IS NOT NULL AND ${left} <> ${right})`);
    }
  }
  return pairs.length > 0 ? `(${pairs.join(' OR ')})` : 'FALSE';
}

export function buildJoinedTableSql(
  joinedTable: string,
  context: BuildMergeContext,
): string {
  const { sources, keyColumns, sourceColumns } = context;
  const aliases = sources.map((_s, idx) => `s${idx}`);

  const selectList: string[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]!;
    const alias = aliases[i]!;
    for (const col of sourceColumns[source.id] ?? []) {
      selectList.push(
        `${alias}.${quoteIdent(col)} AS ${quoteIdent(prefixedColumn(source.id, col))}`,
      );
    }
  }

  const from = `${quoteIdent(sources[0]!.tableName)} ${aliases[0]}`;
  const joins: string[] = [];
  for (let i = 1; i < sources.length; i += 1) {
    const source = sources[i]!;
    const alias = aliases[i]!;
    const prevAliases = aliases.slice(0, i);
    const on = keyColumns
      .map((k) => {
        const left = `COALESCE(${prevAliases.map((a) => `${a}.${quoteIdent(k)}`).join(', ')})`;
        const right = `${alias}.${quoteIdent(k)}`;
        return `${left} = ${right}`;
      })
      .join(' AND ');

    joins.push(`FULL OUTER JOIN ${quoteIdent(source.tableName)} ${alias} ON ${on}`);
  }

  return `CREATE OR REPLACE TABLE ${quoteIdent(joinedTable)} AS SELECT ${selectList.join(', ')} FROM ${from} ${joins.join(' ')}`;
}

function buildFieldWinnerSourceExpr(
  column: string,
  context: BuildMergeContext,
  strategy: MergeConfig['strategy'],
  forcedSource?: string,
): string {
  const refs = context.sources
    .filter((s) => sourceHasColumn(context.sourceColumns, s.id, column))
    .map((s) => ({
      sourceId: s.id,
      valueRef: quoteIdent(prefixedColumn(s.id, column)),
      presentRef: buildPresenceExpr(s.id, context.keyColumns),
    }));

  if (forcedSource) {
    return `'${forcedSource.replace(/'/g, "''")}'`;
  }
  if (refs.length === 0) return 'NULL';

  const whenClauses = refs.map((r) => {
    if (strategy === 'priority-override') {
      return `WHEN ${r.presentRef} = 1 THEN '${r.sourceId.replace(/'/g, "''")}'`;
    }
    return `WHEN NULLIF(TRIM(CAST(${r.valueRef} AS VARCHAR)), '') IS NOT NULL THEN '${r.sourceId.replace(/'/g, "''")}'`;
  });
  return `CASE ${whenClauses.join(' ')} ELSE NULL END`;
}

export function buildFieldValueExpr(
  column: string,
  context: BuildMergeContext,
  strategy: MergeConfig['strategy'],
  forcedSource?: string,
): string {
  if (forcedSource) {
    if (!sourceHasColumn(context.sourceColumns, forcedSource, column)) {
      return 'NULL';
    }
    return quoteIdent(prefixedColumn(forcedSource, column));
  }

  const refs = context.sources
    .filter((s) => sourceHasColumn(context.sourceColumns, s.id, column))
    .map((s) => quoteIdent(prefixedColumn(s.id, column)));

  if (refs.length === 0) return 'NULL';
  if (strategy === 'priority-override') return refs[0]!;
  const normalizedRefs = refs.map((r) => `NULLIF(TRIM(CAST(${r} AS VARCHAR)), '')`);
  return `COALESCE(${normalizedRefs.join(', ')})`;
}

export function buildMergedTableSql(
  mergedTable: string,
  joinedTable: string,
  context: BuildMergeContext,
  config: MergeConfig,
  outputColumns: string[],
): string {
  const fieldStrategyMap = new Map(
    (config.fieldStrategies ?? []).map((f) => [f.field, f]),
  );
  const presentCountExpr = buildPresentCountExpr(context.sources, context.keyColumns);

  const selectList = outputColumns
    .map((col) => {
      const override = fieldStrategyMap.get(col);
      const forcedSource = override?.source;
      const strategy = override?.strategy ?? config.strategy;
      const valueExpr = buildFieldValueExpr(col, context, strategy, forcedSource);
      return `${valueExpr} AS ${quoteIdent(col)}`;
    })
    .join(', ');

  let whereClause = '';
  if (config.strategy === 'intersect') {
    whereClause = ` WHERE (${presentCountExpr}) = ${context.sources.length}`;
  } else if (config.onUnmatched === 'exclude') {
    whereClause = ` WHERE (${presentCountExpr}) > 1`;
  }

  return `CREATE OR REPLACE TABLE ${quoteIdent(mergedTable)} AS SELECT ${selectList} FROM ${quoteIdent(joinedTable)}${whereClause}`;
}

export function buildConflictFieldSelectSql(
  joinedTable: string,
  context: BuildMergeContext,
  field: string,
  config: MergeConfig,
): string | null {
  const override = (config.fieldStrategies ?? []).find((s) => s.field === field);
  const forcedSource = override?.source;
  const strategy = override?.strategy ?? config.strategy;

  const refs = context.sources
    .filter((s) => sourceHasColumn(context.sourceColumns, s.id, field))
    .map((s) => ({
      sourceId: s.id,
      ref: quoteIdent(prefixedColumn(s.id, field)),
    }));

  if (refs.length < 2) return null;

  const keySelect = context.keyColumns
    .map((k) => `${buildCoalescedKeyExpr(context.sources, k)} AS ${quoteIdent(k)}`)
    .join(', ');
  const valueExpr = buildFieldValueExpr(field, context, strategy, forcedSource);
  const winnerExpr = buildFieldWinnerSourceExpr(field, context, strategy, forcedSource);
  const conflictPredicate = buildConflictPredicate(refs.map((r) => r.ref));
  const sourceValuesExpr = refs
    .map((r) => `'${r.sourceId.replace(/'/g, "''")}=' || COALESCE(CAST(${r.ref} AS VARCHAR), '<null>')`)
    .join(` || '; ' || `);

  return `SELECT ${keySelect}, '${field.replace(/'/g, "''")}' AS field, ${winnerExpr} AS winning_source, CAST(${valueExpr} AS VARCHAR) AS winning_value, ${sourceValuesExpr} AS source_values FROM ${quoteIdent(joinedTable)} WHERE ${conflictPredicate}`;
}