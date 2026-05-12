// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import type { MergeConfig } from '../config/types.js';
import type { StagingStore } from '../staging/index.js';
import { logger } from '../utils/logger.js';

import { MergeStrategyRegistry } from './index.js';
import type { MergeResult, MergeSourceMeta } from './types.js';

export class MergeEngine {
  async run(
    store: StagingStore,
    rawSources: MergeSourceMeta[],
    config: MergeConfig,
  ): Promise<MergeResult> {
    const strategyId = config.strategy ?? 'coalesce';
    const strategy = MergeStrategyRegistry.get(strategyId);

    logger.info({ strategy: strategyId }, 'merge: starting');

    try {
      return await strategy.merge(store, rawSources, config);
    } catch (err) {
      logger.error({ err, strategy: strategyId }, 'merge: failed');
      throw err;
    }
  }
}
