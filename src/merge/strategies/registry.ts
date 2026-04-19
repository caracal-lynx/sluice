/**
 * Merge strategy registry.
 * Loads all built-in merge strategies.
 */

import { coalesceStrategy } from './coalesce.js';
import { unionStrategy } from './union.js';
import { intersectStrategy } from './intersect.js';
import type { MergeStrategyPlugin } from '../types.js';

const BUILT_IN_STRATEGIES: Record<string, MergeStrategyPlugin> = {
  coalesce: coalesceStrategy,
  union: unionStrategy,
  intersect: intersectStrategy,
};

export function getStrategy(id: string): MergeStrategyPlugin | undefined {
  return BUILT_IN_STRATEGIES[id];
}

export function listStrategies(): string[] {
  return Object.keys(BUILT_IN_STRATEGIES);
}
