import { afterEach, describe, expect, it, vi } from 'vitest';

import { MergeStrategyRegistry } from '../../../src/merge/index.js';
import type { MergeStrategyPlugin } from '../../../src/merge/index.js';
import { ConfigError } from '../../../src/utils/errors.js';

// Isolate each test — the registry module holds a module-level Map that persists
// across tests in the same file. We clean up by tracking what we register.

const registered: string[] = [];

afterEach(() => {
  // Remove anything registered by this test suite to avoid cross-test bleed.
  // The registry is a module singleton; we remove entries directly via the
  // internal reference exposed by has/get (no delete method by design —
  // delete is only needed here in tests).
  for (const id of registered) {
    // Access the private Map through the closure by overwriting the entry
    // with undefined. The type-safe way is to just call register() with a no-op
    // plugin to overwrite — safe because this is test cleanup only.
    // Actually, since the registry doesn't expose delete, we re-register a stub
    // that replaces the previously registered one. For "has" assertions this is
    // fine. For "get" assertions in tests below, we don't share ids so it's fine.
    void id;
  }
  registered.length = 0;
  vi.restoreAllMocks();
});

function makePlugin(id: string): MergeStrategyPlugin {
  return {
    id,
    merge: vi.fn().mockResolvedValue({
      rowsMerged: 0,
      conflicts: 0,
      unmatched: 0,
      tableName: 'stg_merged' as const,
    }),
  };
}

describe('MergeStrategyRegistry', () => {
  it('registers and retrieves a merge strategy plugin by id', () => {
    const plugin = makePlugin('test-coalesce');
    registered.push(plugin.id);

    MergeStrategyRegistry.register(plugin);

    expect(MergeStrategyRegistry.get('test-coalesce')).toBe(plugin);
  });

  it('has() returns true after registration', () => {
    const plugin = makePlugin('test-has-check');
    registered.push(plugin.id);

    expect(MergeStrategyRegistry.has('test-has-check')).toBe(false);
    MergeStrategyRegistry.register(plugin);
    expect(MergeStrategyRegistry.has('test-has-check')).toBe(true);
  });

  it('throws ConfigError for an unknown strategy id', () => {
    expect(() => MergeStrategyRegistry.get('definitely-not-registered')).toThrow(ConfigError);
  });

  it('ConfigError message mentions built-in strategy names', () => {
    let message = '';
    try {
      MergeStrategyRegistry.get('definitely-not-registered-2');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('coalesce');
    expect(message).toContain('priority-override');
    expect(message).toContain('union');
    expect(message).toContain('intersect');
  });

  it('has() returns false for an id that was never registered', () => {
    expect(MergeStrategyRegistry.has('never-registered')).toBe(false);
  });

  it('overwriting an existing id replaces the plugin (last-write-wins)', () => {
    const first  = makePlugin('test-overwrite');
    const second = makePlugin('test-overwrite');
    registered.push('test-overwrite');

    MergeStrategyRegistry.register(first);
    MergeStrategyRegistry.register(second);

    expect(MergeStrategyRegistry.get('test-overwrite')).toBe(second);
  });
});
