import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadPlugins, loadNpmPlugins } from '../../../src/plugins/loader.js';
import { MergeStrategyRegistry } from '../../../src/merge/index.js';
import { RuleRegistry, TransformRegistry } from '../../../src/plugins/registry.js';
import { ConfigError } from '../../../src/utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolute path to the fixture plugins directory.
const FIXTURE_PLUGINS_DIR = path.resolve(__dirname, '../../fixtures/plugins');

describe('loadPlugins', () => {
  let rules: RuleRegistry;
  let transforms: TransformRegistry;

  beforeEach(() => {
    rules = new RuleRegistry();
    transforms = new TransformRegistry();
  });

  it('silently returns when plugin directory does not exist', async () => {
    await expect(
      loadPlugins('/nonexistent/plugins/dir', rules, transforms),
    ).resolves.toBeUndefined();
    expect(rules.list()).toHaveLength(0);
    expect(transforms.list()).toHaveLength(0);
  });

  it('discovers and registers a *.rule.ts plugin', async () => {
    await loadPlugins(FIXTURE_PLUGINS_DIR, rules, transforms);
    expect(rules.has('testIsUppercase')).toBe(true);
  });

  it('discovers and registers a *.transform.ts plugin', async () => {
    await loadPlugins(FIXTURE_PLUGINS_DIR, rules, transforms);
    expect(transforms.has('testDouble')).toBe(true);
  });

  it('discovers and registers a *.merge.ts plugin when merge registry is provided', async () => {
    await loadPlugins(FIXTURE_PLUGINS_DIR, rules, transforms, MergeStrategyRegistry);
    expect(MergeStrategyRegistry.has('test-merge-strategy')).toBe(true);
  });

  it('registered rule plugin is callable and returns null for valid input', async () => {
    await loadPlugins(FIXTURE_PLUGINS_DIR, rules, transforms);
    const plugin = rules.get('testIsUppercase')!;
    const result = plugin.validate('HELLO', { type: 'testIsUppercase' as never, severity: 'warning' }, 0, 'FIELD');
    expect(result).toBeNull();
  });

  it('registered rule plugin returns violation for invalid input', async () => {
    await loadPlugins(FIXTURE_PLUGINS_DIR, rules, transforms);
    const plugin = rules.get('testIsUppercase')!;
    const result = plugin.validate('hello', { type: 'testIsUppercase' as never, severity: 'warning' }, 0, 'FIELD');
    expect(result).not.toBeNull();
    expect(result?.severity).toBe('warning');
  });

  it('registered transform plugin is callable', async () => {
    await loadPlugins(FIXTURE_PLUGINS_DIR, rules, transforms);
    const plugin = transforms.get('testDouble')!;
    const result = plugin.apply('21', {}, { to: 'x', type: 'custom', customOp: 'testDouble', optional: false });
    expect(result).toBe('42');
  });

  it('throws ConfigError for a malformed plugin file (no rule export)', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'sluice-loader-'));
    try {
      // Copy malformed fixture into a temp dir with the .rule.ts suffix
      const src = path.join(FIXTURE_PLUGINS_DIR, 'malformed.ts');
      const dest = path.join(tmp, 'malformed.rule.ts');
      await fs.copyFile(src, dest);

      await expect(loadPlugins(tmp, rules, transforms)).rejects.toThrow(ConfigError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws ConfigError for a malformed merge plugin file (no mergeStrategy export)', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'sluice-loader-merge-'));
    try {
      const src = path.join(FIXTURE_PLUGINS_DIR, 'malformed.ts');
      const dest = path.join(tmp, 'malformed.merge.ts');
      await fs.copyFile(src, dest);

      await expect(
        loadPlugins(tmp, rules, transforms, MergeStrategyRegistry),
      ).rejects.toThrow(ConfigError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('loadNpmPlugins', () => {
  let rules: RuleRegistry;
  let transforms: TransformRegistry;
  let tmp: string;

  beforeEach(() => {
    rules = new RuleRegistry();
    transforms = new TransformRegistry();
    tmp = mkdtempSync(path.join(tmpdir(), 'sluice-npm-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('silently returns when sluice.config.yaml does not exist', async () => {
    await expect(
      loadNpmPlugins(path.join(tmp, 'sluice.config.yaml'), rules, transforms),
    ).resolves.toBeUndefined();
  });

  it('silently returns for an empty plugins list', async () => {
    const configPath = path.join(tmp, 'sluice.config.yaml');
    writeFileSync(configPath, 'version: "1.0"\nplugins: []\n');
    await expect(loadNpmPlugins(configPath, rules, transforms)).resolves.toBeUndefined();
    expect(rules.list()).toHaveLength(0);
  });

  it('throws ConfigError when a declared package does not export plugin.register', async () => {
    // Use a valid package name that definitely does not export plugin.register — we
    // use 'js-yaml' as a known installed package with no register() export.
    const configPath = path.join(tmp, 'sluice.config.yaml');
    writeFileSync(configPath, 'version: "1.0"\nplugins:\n  - package: "js-yaml"\n');
    await expect(loadNpmPlugins(configPath, rules, transforms)).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when a declared package cannot be resolved', async () => {
    const configPath = path.join(tmp, 'sluice.config.yaml');
    writeFileSync(configPath, 'version: "1.0"\nplugins:\n  - package: "@nonexistent/sluice-test-pkg"\n');
    await expect(loadNpmPlugins(configPath, rules, transforms)).rejects.toThrow(ConfigError);
  });
});
