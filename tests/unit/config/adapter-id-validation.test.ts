// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Where adapter and rule ids are actually checked.
 *
 * DAG-336: `TargetAd` advertised `rest` while no rest target adapter was
 * registered, so `sluice check` passed and the run died at load — after a full
 * extract and transform.
 *
 * DAG-344: the fix for that was a closed enum matching the registry, which then
 * made a plugin-contributed adapter unnameable. The ids are now open strings and
 * ConfigLoader checks them against the registries, so both properties hold: an
 * unregistered id fails at config-load time, and a plugin-registered one passes.
 *
 * The enums remain the BUILT-IN lists, quoted in the `.describe()` text that
 * generates the public schema reference — so they must still match the built-in
 * registrations, or the docs lie.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { dump as yamlDump } from "js-yaml";

import { SourceAd, TargetAd } from "../../../src/config/schema.js";
import { SourceAdapterRegistry } from "../../../src/adapters/source/index.js";
import { TargetAdapterRegistry } from "../../../src/adapters/target/index.js";
import { ConfigLoader } from "../../../src/config/loader.js";
import { ConfigError } from "../../../src/utils/errors.js";

const dir = mkdtempSync(path.join(tmpdir(), "sluice-adapter-ids-"));
let seq = 0;

function writePipeline(overrides: Record<string, unknown>): string {
  const pipeline = {
    pipeline: { name: "adapter-id-test", client: "test", version: "1.0", entity: "Thing" },
    source: { adapter: "csv", file: "./in.csv" },
    dq: { stopOnCritical: true, rules: [] },
    transform: { fields: [{ from: "id", to: "Id", type: "string" }] },
    target: { adapter: "csv", output: "./out.csv" },
    ...overrides,
  };
  const file = path.join(dir, `p${String(seq++)}.pipeline.yaml`);
  writeFileSync(file, yamlDump(pipeline), "utf-8");
  return file;
}

describe("built-in adapter enums", () => {
  it("name exactly the built-in target adapters that are registered", () => {
    expect([...TargetAd.options].sort()).toEqual([...TargetAdapterRegistry.list()].sort());
  });

  it("name exactly the built-in source adapters that are registered", () => {
    expect([...SourceAd.options].sort()).toEqual([...SourceAdapterRegistry.list()].sort());
  });
});

describe("ConfigLoader adapter id validation", () => {
  it("rejects `rest` as a target adapter, naming what is registered", async () => {
    const file = writePipeline({ target: { adapter: "rest", output: "./out.csv" } });
    await expect(ConfigLoader.load(file)).rejects.toThrow(
      /No target adapter registered for "rest".*Registered: .*csv/s,
    );
  });

  it("rejects an unregistered source adapter", async () => {
    const file = writePipeline({ source: { adapter: "oracle", file: "./in.csv" } });
    await expect(ConfigLoader.load(file)).rejects.toThrow(ConfigError);
  });

  it("accepts a plugin-registered target adapter id", async () => {
    TargetAdapterRegistry.register({
      id: "acme-http",
      connect: async () => undefined,
      load: async () => ({ rowsLoaded: 0, rowsFailed: 0 }),
      disconnect: async () => undefined,
    } as unknown as Parameters<typeof TargetAdapterRegistry.register>[0]);

    try {
      const file = writePipeline({ target: { adapter: "acme-http", output: "./out.csv" } });
      const config = await ConfigLoader.load(file);
      expect(config.target.adapter).toBe("acme-http");
    } finally {
      TargetAdapterRegistry.unregister("acme-http");
    }
  });
});
