import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonSourceAdapter } from "../../../../src/adapters/source/json.js";
import { SourceAdapterRegistry } from "../../../../src/adapters/source/index.js";
import type { RunConfig, SourceConfig } from "../../../../src/config/types.js";
import { StagingStore } from "../../../../src/staging/index.js";
import { SourceError } from "../../../../src/utils/errors.js";

const BASE_RUN: RunConfig = {
  mode: "full",
  batchSize: 500,
  onError: "continue",
  logLevel: "info",
  dryRun: false,
  outputDir: "./output",
  stagingDb: "",
};

describe("JsonSourceAdapter", () => {
  let store: StagingStore;
  let tmpDir: string;
  let adapter: JsonSourceAdapter;

  beforeEach(async () => {
    store = new StagingStore(":memory:");
    await store.open();
    tmpDir = mkdtempSync(join(tmpdir(), "sluice-json-src-"));
    adapter = new JsonSourceAdapter();
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeJson(name: string, value: unknown): string {
    const p = join(tmpDir, name);
    writeFileSync(p, JSON.stringify(value), "utf8");
    return p;
  }

  it("extracts a root array into stg_raw with VARCHAR columns", async () => {
    const file = writeJson("root.json", [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    const config: SourceConfig = { adapter: "json", file, delimiter: ",", encoding: "utf-8" };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});

    expect(result.rowsExtracted).toBe(2);
    expect(result.tableName).toBe("stg_raw");
    expect(result.columns).toEqual([
      { name: "id", duckDbType: "VARCHAR" },
      { name: "name", duckDbType: "VARCHAR" },
    ]);
    expect(await store.rowCount("stg_raw")).toBe(2);
  });

  it("resolves a dot-path recordPath to a nested array", async () => {
    const file = writeJson("nested.json", { data: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] } });
    const config: SourceConfig = {
      adapter: "json",
      file,
      recordPath: "data.items",
      delimiter: ",",
      encoding: "utf-8",
    };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(3);
  });

  it("flattens nested objects with __ and stringifies arrays (Legitify-shaped row)", async () => {
    const file = writeJson("findings.json", [
      {
        policy: "two_factor_authentication_not_required_for_org",
        policyInfo: { namespace: "organization", severity: "HIGH" },
        threat: ["credential theft"],
      },
    ]);
    const config: SourceConfig = { adapter: "json", file, delimiter: ",", encoding: "utf-8" };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    const cols = result.columns.map((c) => c.name);
    expect(cols).toContain("policyInfo__namespace");
    expect(cols).toContain("policyInfo__severity");
    expect(cols).toContain("threat"); // array -> JSON text cell
    expect(await store.columnNames("stg_raw")).toEqual(cols);
  });

  it("honours a custom targetTable", async () => {
    const file = writeJson("t.json", [{ id: 1 }]);
    const config: SourceConfig = { adapter: "json", file, delimiter: ",", encoding: "utf-8" };
    const result = await adapter.extract(config, store, BASE_RUN, () => {}, "stg_raw_legitify");
    expect(result.tableName).toBe("stg_raw_legitify");
    expect(await store.tableExists("stg_raw_legitify")).toBe(true);
  });

  it("emits onProgress after each batch flush", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const file = writeJson("big.json", rows);
    const config: SourceConfig = { adapter: "json", file, delimiter: ",", encoding: "utf-8" };
    const progress: number[] = [];
    await adapter.extract(config, store, { ...BASE_RUN, batchSize: 10 }, (n) => progress.push(n));
    expect(progress).toEqual([10, 20, 25]);
  });

  it("throws SourceError when `file` is not set", async () => {
    const config = { adapter: "json", delimiter: ",", encoding: "utf-8" } as SourceConfig;
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it("throws SourceError when recordPath does not resolve to an array", async () => {
    const file = writeJson("obj.json", { data: { notAnArray: true } });
    const config: SourceConfig = {
      adapter: "json",
      file,
      recordPath: "data.notAnArray",
      delimiter: ",",
      encoding: "utf-8",
    };
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it("throws SourceError on invalid JSON", async () => {
    const p = join(tmpDir, "bad.json");
    writeFileSync(p, "{ not json", "utf8");
    const config: SourceConfig = { adapter: "json", file: p, delimiter: ",", encoding: "utf-8" };
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });
});

describe("SourceAdapterRegistry (json)", () => {
  it("has the json adapter registered via the barrel import", () => {
    expect(SourceAdapterRegistry.has("json")).toBe(true);
    expect(SourceAdapterRegistry.get("json").id).toBe("json");
  });
});
