import type { MergeConfig } from '@/config/types.js';
import type { StagingStore } from '@/staging/index.js';
import { ConfigError } from '@/utils/errors.js';
import { logger } from '@/utils/logger.js';

import { MergeStrategyRegistry } from './index.js';
import type { MergeResult, MergeSourceMeta } from './types.js';

function buildOutputColumns(
  sources: MergeSourceMeta[],
  sourceColumns: Record<string, string[]>,
  keyColumns: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const key of keyColumns) {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }

  for (const source of sources) {
    for (const col of sourceColumns[source.id] ?? []) {
      if (!seen.has(col)) {
        seen.add(col);
        out.push(col);
      }
    }
  }

  return out;
}

export class MergeEngine {
  async run(
    store: StagingStore,
    rawSources: MergeSourceMeta[],
    config: MergeConfig,
  ): Promise<MergeResult> {
    const strategyId = config.strategy ?? 'coalesce';
    let strategy;

    try {
      strategy = MergeStrategyRegistry.get(strategyId);
    } catch (err) {
      const supported = MergeStrategyRegistry.list().join(', ');
      throw new ConfigError(
        `unknown merge strategy '${strategyId}'. Supported: ${supported}`,
      );
    }

    logger.info({ strategy: strategyId }, 'merge: starting');

    try {
      return await strategy.merge(store, rawSources, config);
    } catch (err) {
      logger.error({ err, strategy: strategyId }, 'merge: failed');
      throw err;
    }
  }
}