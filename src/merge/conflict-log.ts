import type { MergeConfig } from '@/config/types.js';
import type { StagingStore } from '@/staging/index.js';
import { quoteIdent } from '@/staging/index.js';

import {
  type BuildMergeContext,
  buildConflictFieldSelectSql,
} from './sql-builder.js';

export interface ConflictLogResult {
  count: number;
  tableName: string;
}

function buildEmptyConflictTableSql(tableName: string, keyColumns: string[]): string {
  const keyCols = keyColumns
    .map((k) => `CAST(NULL AS VARCHAR) AS ${quoteIdent(k)}`)
    .join(', ');
  const leading = keyCols.length > 0 ? `${keyCols}, ` : '';
  return `CREATE OR REPLACE TABLE ${quoteIdent(tableName)} AS SELECT ${leading}CAST(NULL AS VARCHAR) AS field, CAST(NULL AS VARCHAR) AS winning_source, CAST(NULL AS VARCHAR) AS winning_value, CAST(NULL AS VARCHAR) AS source_values WHERE FALSE`;
}

export async function buildConflictLog(
  store: StagingStore,
  joinedTable: string,
  context: BuildMergeContext,
  config: MergeConfig,
  outputColumns: string[],
  conflictTableName = 'stg_merge_conflicts',
): Promise<ConflictLogResult> {
  const selects = outputColumns
    .map((field) => buildConflictFieldSelectSql(joinedTable, context, field, config))
    .filter((s): s is string => s !== null);

  if (selects.length === 0) {
    await store.query(buildEmptyConflictTableSql(conflictTableName, context.keyColumns));
  } else {
    await store.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(conflictTableName)} AS ${selects.join(' UNION ALL ')}`,
    );
  }

  const count = await store.rowCount(conflictTableName);
  if (config.conflictLog && count > 0) {
    await store.exportToCsv(conflictTableName, config.conflictLog, { header: true });
  }

  return { count, tableName: conflictTableName };
}
