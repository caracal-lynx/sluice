import type { MergeStrategyPlugin } from '../../../src/merge/index.js';

export const mergeStrategy: MergeStrategyPlugin = {
  id: 'test-merge-strategy',
  description: 'Fixture merge strategy for plugin loader tests',
  async merge() {
    return {
      rowsMerged: 0,
      conflicts: 0,
      unmatched: 0,
      tableName: 'stg_merged',
    };
  },
};
