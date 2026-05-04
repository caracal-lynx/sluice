// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

import type { MergeStrategyPlugin } from './types.js';
import { ConfigError } from '../utils/errors.js';
import { coalesceStrategy } from './strategies/coalesce.js';
import { unionStrategy } from './strategies/union.js';
import { intersectStrategy } from './strategies/intersect.js';
import { priorityOverrideStrategy } from './strategies/priority-override.js';

export { MergeEngine } from './engine.js';
export type { BuildMergeContext } from './sql-builder.js';

const registry = new Map<string, MergeStrategyPlugin>();

// Pre-register all built-in strategies
registry.set(coalesceStrategy.id, coalesceStrategy);
registry.set(unionStrategy.id, unionStrategy);
registry.set(intersectStrategy.id, intersectStrategy);
registry.set(priorityOverrideStrategy.id, priorityOverrideStrategy);

export const MergeStrategyRegistry = {
  register(plugin: MergeStrategyPlugin): void {
    registry.set(plugin.id, plugin);
  },

  get(id: string): MergeStrategyPlugin {
    const plugin = registry.get(id);
    if (!plugin) {
      const supported = Array.from(registry.keys()).join(', ');
      throw new ConfigError(
        `No merge strategy registered for id '${id}'. Supported: ${supported}`,
      );
    }
    return plugin;
  },

  has(id: string): boolean {
    return registry.has(id);
  },

  list(): string[] {
    return Array.from(registry.keys());
  },
};

export type { MergeStrategyPlugin, MergeSourceMeta, MergeResult } from './types.js';
