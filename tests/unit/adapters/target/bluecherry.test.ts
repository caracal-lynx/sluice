import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BlueCherryTargetAdapter } from "../../../../src/adapters/target/bluecherry.js";
import type { RunConfig, TargetConfig } from "../../../../src/config/types.js";
import { StagingStore } from "../../../../src/staging/index.js";
import { ConfigError } from "../../../../src/utils/errors.js";

const BASE_RUN: RunConfig = {
  mode: "full",
  batchSize: 500,
  onError: "continue",
  logLevel: "info",
  dryRun: false,
  outputDir: "./output",
  stagingDb: "",
};

function bcTarget(overrides: Partial<TargetConfig>): TargetConfig {
  return {
    adapter: "bluecherry",
    entity: "Style",
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

describe("BlueCherryTargetAdapter", () => {
  let store: StagingStore;
  let tmp: string;

  beforeEach(async () => {
    store = new StagingStore(":memory:");
    await store.open();
    tmp = mkdtempSync(join(tmpdir(), "sluice-bc-"));
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function stageStyleColumns(extra: Record<string, string>[] = []): Promise<void> {
    await store.createTable("stg_transformed", [
      { name: "StyleNo", duckDbType: "VARCHAR" },
      { name: "StyleDesc", duckDbType: "VARCHAR" },
      { name: "Division", duckDbType: "VARCHAR" },
      { name: "Season", duckDbType: "VARCHAR" },
      { name: "CostPrice", duckDbType: "VARCHAR" },
      { name: "RetailPrice", duckDbType: "VARCHAR" },
      { name: "ActiveFlag", duckDbType: "VARCHAR" },
      { name: "CreatedDate", duckDbType: "VARCHAR" },
    ]);
    await store.insertBatch("stg_transformed", [
      {
        StyleNo: "S001",
        StyleDesc: "Aran Jumper",
        Division: "WOMENS",
        Season: "AW25",
        CostPrice: "25.00",
        RetailPrice: "89.99",
        ActiveFlag: "Y",
        CreatedDate: "2026-04-15",
      },
      ...extra,
    ]);
  }

  it("throws ConfigError when required columns are missing", async () => {
    await store.createTable("stg_transformed", [{ name: "StyleNo", duckDbType: "VARCHAR" }]);
    const adapter = new BlueCherryTargetAdapter();
    const target = bcTarget({ output: join(tmp, "out.csv") });
    await adapter.connect(target);
    await expect(adapter.load(target, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("throws ConfigError for unknown entity at connect()", async () => {
    const adapter = new BlueCherryTargetAdapter();
    await expect(
      adapter.connect(bcTarget({ entity: "NoSuchEntity", output: "/dev/null" })),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("writes the default-template column order with header", async () => {
    await stageStyleColumns();
    const adapter = new BlueCherryTargetAdapter();
    const output = join(tmp, "out.csv");
    const target = bcTarget({ output });
    await adapter.connect(target);
    await adapter.load(target, store, BASE_RUN, () => {});
    const contents = readFileSync(output, "utf-8");
    const firstLine = contents.split(/\r?\n/)[0]!;
    // REQUIRED_COLUMNS order first, extras appended
    expect(firstLine).toBe(
      "StyleNo,StyleDesc,Division,Season,CostPrice,RetailPrice,ActiveFlag,CreatedDate",
    );
    expect(contents).toContain("S001,Aran Jumper,WOMENS,AW25");
  });

  it("auto-formats Date-suffixed columns via target.dateFormat", async () => {
    await stageStyleColumns();
    const adapter = new BlueCherryTargetAdapter();
    const output = join(tmp, "out.csv");
    const target = bcTarget({ output, dateFormat: "MM/DD/YYYY" });
    await adapter.connect(target);
    await adapter.load(target, store, BASE_RUN, () => {});
    const contents = readFileSync(output, "utf-8");
    expect(contents).toContain("04/15/2026");
  });

  it("honours a template CSV file for column order", async () => {
    await stageStyleColumns();
    const templatePath = join(tmp, "tpl.csv");
    writeFileSync(
      templatePath,
      "ActiveFlag,StyleNo,StyleDesc,Division,Season,CostPrice,RetailPrice\n",
      "utf-8",
    );
    const adapter = new BlueCherryTargetAdapter();
    const output = join(tmp, "out.csv");
    const target = bcTarget({ output, template: templatePath });
    await adapter.connect(target);
    await adapter.load(target, store, BASE_RUN, () => {});
    const firstLine = readFileSync(output, "utf-8").split(/\r?\n/)[0]!;
    expect(firstLine).toBe("ActiveFlag,StyleNo,StyleDesc,Division,Season,CostPrice,RetailPrice");
  });

  it("renders nulls using target.nullValue", async () => {
    await store.createTable("stg_transformed", [
      { name: "StyleNo", duckDbType: "VARCHAR" },
      { name: "StyleDesc", duckDbType: "VARCHAR" },
      { name: "Division", duckDbType: "VARCHAR" },
      { name: "Season", duckDbType: "VARCHAR" },
      { name: "CostPrice", duckDbType: "VARCHAR" },
      { name: "RetailPrice", duckDbType: "VARCHAR" },
      { name: "ActiveFlag", duckDbType: "VARCHAR" },
    ]);
    await store.insertBatch("stg_transformed", [
      {
        StyleNo: "S1",
        StyleDesc: "x",
        Division: null,
        Season: "SS26",
        CostPrice: "1",
        RetailPrice: "2",
        ActiveFlag: "Y",
      },
    ]);
    const adapter = new BlueCherryTargetAdapter();
    const output = join(tmp, "null.csv");
    const target = bcTarget({ output, nullValue: "NULL" });
    await adapter.connect(target);
    await adapter.load(target, store, BASE_RUN, () => {});
    expect(readFileSync(output, "utf-8")).toContain("NULL");
  });
});
