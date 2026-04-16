import { describe, it, expect } from 'vitest';
import { RuleRegistry, TransformRegistry } from '@/plugins/registry';
import type { RulePlugin, TransformPlugin, CustomFieldMapping } from '@/plugins/types';
import { ConfigError } from '@/utils/errors';

// ── Minimal fixture plugins ───────────────────────────────────────────────────

const makeRulePlugin = (id: string): RulePlugin => ({
  id,
  validate: () => null,
});

const makeTransformPlugin = (id: string): TransformPlugin => ({
  id,
  apply: (value: unknown, _row: Record<string, unknown>, _config: CustomFieldMapping) => value,
});

// ── RuleRegistry ──────────────────────────────────────────────────────────────

describe('RuleRegistry', () => {
  it('registers a plugin and retrieves it by id', () => {
    const registry = new RuleRegistry();
    const plugin = makeRulePlugin('myRule');
    registry.register(plugin);
    expect(registry.get('myRule')).toBe(plugin);
  });

  it('get() returns undefined for an unknown id', () => {
    const registry = new RuleRegistry();
    expect(registry.get('nonExistent')).toBeUndefined();
  });

  it('has() returns true for a registered id', () => {
    const registry = new RuleRegistry();
    registry.register(makeRulePlugin('myRule'));
    expect(registry.has('myRule')).toBe(true);
  });

  it('has() returns false for an unknown id', () => {
    const registry = new RuleRegistry();
    expect(registry.has('nonExistent')).toBe(false);
  });

  it('list() returns all registered plugin ids', () => {
    const registry = new RuleRegistry();
    registry.register(makeRulePlugin('ruleA'));
    registry.register(makeRulePlugin('ruleB'));
    registry.register(makeRulePlugin('ruleC'));
    const ids = registry.list();
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(['ruleA', 'ruleB', 'ruleC']));
  });

  it('list() returns empty array when no plugins registered', () => {
    const registry = new RuleRegistry();
    expect(registry.list()).toEqual([]);
  });

  it('throws ConfigError on duplicate id', () => {
    const registry = new RuleRegistry();
    registry.register(makeRulePlugin('dup'));
    expect(() => registry.register(makeRulePlugin('dup'))).toThrow(ConfigError);
  });

  it('ConfigError on duplicate includes the plugin id', () => {
    const registry = new RuleRegistry();
    registry.register(makeRulePlugin('dup'));
    expect(() => registry.register(makeRulePlugin('dup'))).toThrowError(/dup/);
  });

  it('allows registering distinct ids without error', () => {
    const registry = new RuleRegistry();
    expect(() => {
      registry.register(makeRulePlugin('a'));
      registry.register(makeRulePlugin('b'));
    }).not.toThrow();
  });
});

// ── TransformRegistry ─────────────────────────────────────────────────────────

describe('TransformRegistry', () => {
  it('registers a plugin and retrieves it by id', () => {
    const registry = new TransformRegistry();
    const plugin = makeTransformPlugin('myTransform');
    registry.register(plugin);
    expect(registry.get('myTransform')).toBe(plugin);
  });

  it('get() returns undefined for an unknown id', () => {
    const registry = new TransformRegistry();
    expect(registry.get('nonExistent')).toBeUndefined();
  });

  it('has() returns true for a registered id', () => {
    const registry = new TransformRegistry();
    registry.register(makeTransformPlugin('myTransform'));
    expect(registry.has('myTransform')).toBe(true);
  });

  it('has() returns false for an unknown id', () => {
    const registry = new TransformRegistry();
    expect(registry.has('nonExistent')).toBe(false);
  });

  it('list() returns all registered plugin ids', () => {
    const registry = new TransformRegistry();
    registry.register(makeTransformPlugin('transformA'));
    registry.register(makeTransformPlugin('transformB'));
    const ids = registry.list();
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining(['transformA', 'transformB']));
  });

  it('list() returns empty array when no plugins registered', () => {
    const registry = new TransformRegistry();
    expect(registry.list()).toEqual([]);
  });

  it('throws ConfigError on duplicate id', () => {
    const registry = new TransformRegistry();
    registry.register(makeTransformPlugin('dup'));
    expect(() => registry.register(makeTransformPlugin('dup'))).toThrow(ConfigError);
  });

  it('ConfigError on duplicate includes the plugin id', () => {
    const registry = new TransformRegistry();
    registry.register(makeTransformPlugin('dup'));
    expect(() => registry.register(makeTransformPlugin('dup'))).toThrowError(/dup/);
  });

  it('allows registering distinct ids without error', () => {
    const registry = new TransformRegistry();
    expect(() => {
      registry.register(makeTransformPlugin('x'));
      registry.register(makeTransformPlugin('y'));
    }).not.toThrow();
  });

  it('registered plugin apply() is callable', () => {
    const registry = new TransformRegistry();
    const plugin: TransformPlugin = {
      id: 'double',
      apply: (value) => Number(value) * 2,
    };
    registry.register(plugin);
    const retrieved = registry.get('double')!;
    const fakeMapping: CustomFieldMapping = { to: 'out', type: 'custom', customOp: 'double' };
    expect(retrieved.apply(21, {}, fakeMapping)).toBe(42);
  });
});
