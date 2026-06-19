import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IfsTargetAdapter } from "../../../../src/adapters/target/ifs.js";
import type { RunConfig, TargetConfig } from "../../../../src/config/types.js";
import { StagingStore } from "../../../../src/staging/index.js";
import { LoadError } from "../../../../src/utils/errors.js";

const BASE_RUN: RunConfig = {
  mode: "full",
  batchSize: 500,
  onError: "continue",
  logLevel: "info",
  dryRun: false,
  outputDir: "./output",
  stagingDb: "",
};

function baseTarget(output: string, overrides: Partial<TargetConfig> = {}): TargetConfig {
  return {
    adapter: "ifs",
    output,
    delimiter: ",",
    encoding: "utf-8",
    nullValue: "",
    apiVersion: "v2.0",
    onConflict: "fail",
    batchEndpoint: true,
    schema: "public",
    ...overrides,
  } as TargetConfig;
}

describe("IfsTargetAdapter", () => {
  let store: StagingStore;
  let tmp: string;

  beforeEach(async () => {
    store = new StagingStore(":memory:");
    await store.open();
    tmp = mkdtempSync(join(tmpdir(), "sluice-ifs-"));
    await store.createTable("stg_transformed", [
      { name: "CustomerNo", duckDbType: "VARCHAR" },
      { name: "Name", duckDbType: "VARCHAR" },
      { name: "Country", duckDbType: "VARCHAR" },
    ]);
    await store.insertBatch("stg_transformed", [
      { CustomerNo: "A001", Name: "Alice", Country: "GB" },
      { CustomerNo: "A002", Name: "Bob", Country: "GB" },
    ]);
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes CSV without header by default and in natural column order", async () => {
    const adapter = new IfsTargetAdapter();
    const outputPath = join(tmp, "out.csv");
    await adapter.connect(baseTarget(outputPath));
    await adapter.load(baseTarget(outputPath), store, BASE_RUN, () => {});
    const contents = readFileSync(outputPath, "utf-8");
    expect(contents).not.toContain("CustomerNo,Name");
    expect(contents).toContain("A001,Alice,GB");
    expect(contents).toContain("A002,Bob,GB");
  });

  it("respects columnOrder", async () => {
    const adapter = new IfsTargetAdapter();
    const outputPath = join(tmp, "out.csv");
    const target = baseTarget(outputPath, { columnOrder: ["Name", "CustomerNo"] });
    await adapter.connect(target);
    await adapter.load(target, store, BASE_RUN, () => {});
    const contents = readFileSync(outputPath, "utf-8");
    expect(contents).toContain("Alice,A001");
    expect(contents).not.toContain("A001,Alice");
  });

  it("throws LoadError when columnOrder references missing columns", async () => {
    const adapter = new IfsTargetAdapter();
    const target = baseTarget(join(tmp, "out.csv"), { columnOrder: ["Nope"] });
    await adapter.connect(target);
    await expect(adapter.load(target, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(LoadError);
  });

  it("writes header when includeHeader: true", async () => {
    const adapter = new IfsTargetAdapter();
    const target = baseTarget(join(tmp, "out.csv"), { includeHeader: true });
    await adapter.connect(target);
    await adapter.load(target, store, BASE_RUN, () => {});
    const contents = readFileSync(join(tmp, "out.csv"), "utf-8");
    expect(contents).toContain("CustomerNo,Name,Country");
  });
});
