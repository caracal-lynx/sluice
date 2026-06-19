/**
 * CLI plugins command integration tests — verify that plugins are discovered,
 * loaded, and listed correctly.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MergeStrategyRegistry } from "../../src/merge/index.js";
import {
  RuleRegistry,
  TransformRegistry,
  loadPlugins,
  loadNpmPlugins,
} from "../../src/plugins/index.js";

const fixtureDir = path.join(import.meta.dirname ?? "", "../fixtures/plugins");
const tmpDir = path.join(import.meta.dirname ?? "", "../../.tmp-plugins-cli");

describe("sluice plugins command", () => {
  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("should load fixture rule plugins from disk", async () => {
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();

    // Load plugins from fixture directory
    await loadPlugins(fixtureDir, ruleRegistry, transformRegistry);

    const ruleIds = ruleRegistry.list();
    expect(ruleIds).toContain("testIsUppercase");
    expect(ruleIds).toContain("strict-email");
  });

  it("should load fixture transform plugins from disk", async () => {
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();

    // Load plugins from fixture directory
    await loadPlugins(fixtureDir, ruleRegistry, transformRegistry);

    const transformIds = transformRegistry.list();
    expect(transformIds).toContain("testDouble");
    expect(transformIds).toContain("testPriceWithMargin");
    expect(transformIds).toContain("testConcatWithRow");
    expect(transformIds).toContain("slug-generator");
    expect(transformIds).toContain("hash-value");
  });

  it("should handle non-existent plugin directory gracefully", async () => {
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();

    const nonExistentDir = path.join(tmpDir, "does-not-exist");
    await expect(
      loadPlugins(nonExistentDir, ruleRegistry, transformRegistry),
    ).resolves.not.toThrow();

    expect(ruleRegistry.list().length).toBe(0);
    expect(transformRegistry.list().length).toBe(0);
  });

  it("should handle non-existent sluice.config.yaml gracefully", async () => {
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();

    const configPath = path.join(tmpDir, "sluice.config.yaml");
    await expect(
      loadNpmPlugins(configPath, ruleRegistry, transformRegistry),
    ).resolves.not.toThrow();
  });

  it("should register loaded plugins and make them queryable", async () => {
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();

    await loadPlugins(fixtureDir, ruleRegistry, transformRegistry);

    // Query a specific rule plugin
    const strictEmailRule = ruleRegistry.get("strict-email");
    expect(strictEmailRule).toBeDefined();
    expect(strictEmailRule?.id).toBe("strict-email");

    // Query a specific transform plugin
    const slugTransform = transformRegistry.get("slug-generator");
    expect(slugTransform).toBeDefined();
    expect(slugTransform?.id).toBe("slug-generator");
  });

  it("should support applying transform plugins after discovery", async () => {
    const transformRegistry = new TransformRegistry();
    const ruleRegistry = new RuleRegistry();

    await loadPlugins(fixtureDir, ruleRegistry, transformRegistry);

    // Apply the slug-generator transform
    const slugTransform = transformRegistry.get("slug-generator");
    expect(slugTransform).toBeDefined();

    const result = await slugTransform!.apply("Hello World Example", {
      separator: "-",
      lowercase: true,
    });
    expect(result).toBe("hello-world-example");
  });

  it("should support applying hash-value transform after discovery", async () => {
    const transformRegistry = new TransformRegistry();
    const ruleRegistry = new RuleRegistry();

    await loadPlugins(fixtureDir, ruleRegistry, transformRegistry);

    const hashTransform = transformRegistry.get("hash-value");
    expect(hashTransform).toBeDefined();

    const result = await hashTransform!.apply("test@example.com", {
      algorithm: "sha256",
      truncate: 8,
    });
    expect(typeof result).toBe("string");
    expect((result as string).length).toBe(8);
  });

  it("should register merge strategy plugins when merge registry is provided", async () => {
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();

    await loadPlugins(fixtureDir, ruleRegistry, transformRegistry, MergeStrategyRegistry);
    expect(MergeStrategyRegistry.has("test-merge-strategy")).toBe(true);
  });

  it("should list all discovered plugins", async () => {
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();

    await loadPlugins(fixtureDir, ruleRegistry, transformRegistry);

    const allRules = ruleRegistry.list();
    const allTransforms = transformRegistry.list();

    console.log("Discovered rules:", allRules);
    console.log("Discovered transforms:", allTransforms);

    expect(allRules.length).toBeGreaterThan(0);
    expect(allTransforms.length).toBeGreaterThan(0);
  });

  it("should reject duplicate plugin IDs", async () => {
    const transformRegistry = new TransformRegistry();

    // Register a plugin
    transformRegistry.register({
      id: "duplicate-id",
      apply: async () => "test",
    });

    // Try to register another with the same ID
    expect(() => {
      transformRegistry.register({
        id: "duplicate-id",
        apply: async () => "test2",
      });
    }).toThrow();
  });
});
