import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { XlsxSourceAdapter } from "../../../../src/adapters/source/xlsx.js";
import type { RunConfig, SourceConfig } from "../../../../src/config/types.js";
import { StagingStore } from "../../../../src/staging/index.js";

const BASE_RUN: RunConfig = {
  mode: "full",
  batchSize: 500,
  onError: "continue",
  logLevel: "info",
  dryRun: false,
  outputDir: "./output",
  stagingDb: "",
};

// Committed workbooks (DAG-207). Previously these were generated at test time
// with exceljs; that dependency is gone, and a binary fixture is a truer test
// of the reader anyway — it pins the exact bytes we parse.
//   single.xlsx     — sheet "Data":  id,name / 1,a / 2,b
//   multi.xlsx      — sheets "Alpha" (x/one) and "Beta" (x/two)
//   single-col.xlsx — sheet "Data":  a / x
const FIXTURES = join(import.meta.dirname, "../../../fixtures/xlsx");
const fixture = (name: string): string => join(FIXTURES, name);

describe("XlsxSourceAdapter", () => {
  let store: StagingStore;

  beforeEach(async () => {
    store = new StagingStore(":memory:");
    await store.open();
  });

  afterEach(async () => {
    await store.close();
  });

  it("reads a single-sheet XLSX and stages rows as VARCHAR", async () => {
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = {
      adapter: "xlsx",
      file: fixture("single.xlsx"),
      delimiter: ",",
      encoding: "utf-8",
    };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(2);
    expect(result.columns.map((c) => c.name)).toEqual(["id", "name"]);
    expect(result.columns.every((c) => c.duckDbType === "VARCHAR")).toBe(true);
    await adapter.disconnect();
  });

  it("warns when multiple sheets exist and sheet is unset", async () => {
    const warnSpy = vi.spyOn(
      await import("../../../../src/utils/logger.js").then((m) => m.logger),
      "warn",
    );
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = {
      adapter: "xlsx",
      file: fixture("multi.xlsx"),
      delimiter: ",",
      encoding: "utf-8",
    };
    await adapter.connect(config);
    await adapter.extract(config, store, BASE_RUN, () => {});
    expect(warnSpy).toHaveBeenCalled();
  });

  it("reads a named sheet when specified", async () => {
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = {
      adapter: "xlsx",
      file: fixture("multi.xlsx"),
      sheet: "Beta",
      delimiter: ",",
      encoding: "utf-8",
    };
    await adapter.connect(config);
    await adapter.extract(config, store, BASE_RUN, () => {});
    const rows = await store.query<{ x: string }>("SELECT * FROM stg_raw");
    expect(rows[0]!.x).toBe("two");
  });

  it("reads a sheet by zero-based index", async () => {
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = {
      adapter: "xlsx",
      file: fixture("multi.xlsx"),
      sheet: 1,
      delimiter: ",",
      encoding: "utf-8",
    };
    await adapter.connect(config);
    await adapter.extract(config, store, BASE_RUN, () => {});
    const rows = await store.query<{ x: string }>("SELECT * FROM stg_raw");
    expect(rows[0]!.x).toBe("two");
  });

  it("throws when the named sheet is absent", async () => {
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = {
      adapter: "xlsx",
      file: fixture("multi.xlsx"),
      sheet: "Nope",
      delimiter: ",",
      encoding: "utf-8",
    };
    await adapter.connect(config);
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toThrow(/not found/);
  });

  it("honours a custom targetTable (Phase 3 prep Change 1)", async () => {
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = {
      adapter: "xlsx",
      file: fixture("single-col.xlsx"),
      delimiter: ",",
      encoding: "utf-8",
    };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {}, "stg_raw_excel");
    expect(result.tableName).toBe("stg_raw_excel");
    expect(await store.tableExists("stg_raw_excel")).toBe(true);
  });
});
