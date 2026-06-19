import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OdooCsvSourceAdapter } from "../../../../src/adapters/source/odoo-csv.js";
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

function pivotConfig(
  overrides: Partial<NonNullable<SourceConfig["pivot"]>> = {},
): NonNullable<SourceConfig["pivot"]> {
  return {
    column: "Variant Values",
    keys: ["Size", "Colours Pioneer"],
    onUnknownKey: "warn",
    dropOriginal: true,
    ...overrides,
  };
}

describe("OdooCsvSourceAdapter", () => {
  let store: StagingStore;
  let tmpDir: string;
  let adapter: OdooCsvSourceAdapter;

  beforeEach(async () => {
    store = new StagingStore(":memory:");
    await store.open();
    tmpDir = mkdtempSync(join(tmpdir(), "sluice-odoo-csv-"));
    adapter = new OdooCsvSourceAdapter();
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeCsv(name: string, content: string): string {
    const p = join(tmpDir, name);
    writeFileSync(p, content, "utf8");
    return p;
  }

  it("without pivot config, behaves like the plain csv adapter", async () => {
    const file = writeCsv("plain.csv", "id,name\n1,Alice\n2,Bob\n");
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
    };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(2);
    expect(result.columns.map((c) => c.name)).toEqual(["id", "name"]);
    expect(await store.rowCount("stg_raw")).toBe(2);
  });

  it("merges continuation rows into the preceding parent and pivots Key: value cells", async () => {
    // Pioneer Cardigan shape: parent has Size, continuation has Colours.
    const file = writeCsv(
      "products.csv",
      "Internal Reference,Name,Variant Values,Unit of Measure\n" +
        "C3249AUTF23,Pioneer Slouch Cardigan (C3249),Size: XS/S,Units\n" +
        ",,Colours Pioneer: Autumn,\n" +
        "C3249AUTF34,Pioneer Slouch Cardigan (C3249),Size: S/M,Units\n" +
        ",,Colours Pioneer: Autumn,\n",
    );
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
      pivot: pivotConfig(),
    };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});

    expect(result.rowsExtracted).toBe(2);
    expect(result.columns.map((c) => c.name)).toEqual([
      "Internal Reference",
      "Name",
      "Unit of Measure",
      "Size",
      "Colours Pioneer",
    ]);

    const rows = await store.query<Record<string, string>>(
      'SELECT * FROM stg_raw ORDER BY "Internal Reference"',
    );
    expect(rows).toEqual([
      {
        "Internal Reference": "C3249AUTF23",
        Name: "Pioneer Slouch Cardigan (C3249)",
        "Unit of Measure": "Units",
        Size: "XS/S",
        "Colours Pioneer": "Autumn",
      },
      {
        "Internal Reference": "C3249AUTF34",
        Name: "Pioneer Slouch Cardigan (C3249)",
        "Unit of Measure": "Units",
        Size: "S/M",
        "Colours Pioneer": "Autumn",
      },
    ]);
  });

  it("emits null for declared pivot keys not seen on a row", async () => {
    // Metal-zipper shape: only Size, no Colours continuation.
    const file = writeCsv(
      "zippers.csv",
      "Internal Reference,Variant Values\n3055971ZIP02,Size: 48 cm\n",
    );
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
      pivot: pivotConfig(),
    };
    await adapter.extract(config, store, BASE_RUN, () => {});
    const rows = await store.query<{ Size: string | null; "Colours Pioneer": string | null }>(
      "SELECT * FROM stg_raw",
    );
    expect(rows[0]!.Size).toBe("48 cm");
    expect(rows[0]!["Colours Pioneer"]).toBeNull();
  });

  it("keeps the pivot column when dropOriginal: false", async () => {
    const file = writeCsv("simple.csv", "Internal Reference,Variant Values\nA,Size: M\n");
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
      pivot: pivotConfig({ dropOriginal: false }),
    };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.columns.map((c) => c.name)).toEqual([
      "Internal Reference",
      "Variant Values",
      "Size",
      "Colours Pioneer",
    ]);
    const rows = await store.query<Record<string, string>>("SELECT * FROM stg_raw");
    expect(rows[0]!["Variant Values"]).toBe("Size: M");
    expect(rows[0]!.Size).toBe("M");
  });

  it("throws SourceError on an orphan continuation row", async () => {
    const file = writeCsv(
      "orphan.csv",
      "Internal Reference,Variant Values\n,Colours Pioneer: Autumn\nA,Size: M\n",
    );
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
      pivot: pivotConfig(),
    };
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it("throws SourceError when pivot.column is not in the input header", async () => {
    const file = writeCsv("bad.csv", "id,name\n1,Alice\n");
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
      pivot: pivotConfig({ column: "Variant Values" }),
    };
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it("drops unknown pivot keys in warn mode (default) — schema stays declared-keys-only", async () => {
    const file = writeCsv(
      "unknown.csv",
      "Internal Reference,Variant Values\nA,Size: M\n,Frobnitz: 42\n",
    );
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
      pivot: pivotConfig(),
    };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    // Output columns are declared keys only — no Frobnitz.
    expect(result.columns.map((c) => c.name)).toEqual([
      "Internal Reference",
      "Size",
      "Colours Pioneer",
    ]);
    const rows = await store.query<Record<string, string>>("SELECT * FROM stg_raw");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Size).toBe("M");
  });

  it("throws on unknown pivot keys when onUnknownKey: error", async () => {
    const file = writeCsv(
      "unknown.csv",
      "Internal Reference,Variant Values\nA,Size: M\n,Frobnitz: 42\n",
    );
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
      pivot: pivotConfig({ onUnknownKey: "error" }),
    };
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it("last-wins on a duplicate pivot key inside one logical row", async () => {
    const file = writeCsv("dupes.csv", "Internal Reference,Variant Values\nA,Size: M\n,Size: L\n");
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
      pivot: pivotConfig(),
    };
    await adapter.extract(config, store, BASE_RUN, () => {});
    const rows = await store.query<{ Size: string }>("SELECT * FROM stg_raw");
    expect(rows[0]!.Size).toBe("L");
  });

  it("honours a custom targetTable", async () => {
    const file = writeCsv("simple.csv", "id\n1\n");
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
    };
    const result = await adapter.extract(config, store, BASE_RUN, () => {}, "stg_raw_odoo");
    expect(result.tableName).toBe("stg_raw_odoo");
    expect(await store.tableExists("stg_raw_odoo")).toBe(true);
    expect(await store.tableExists("stg_raw")).toBe(false);
  });

  it("skips wholly blank continuation rows", async () => {
    // The middle row is "all empty" — should be skipped, not flagged as orphan.
    // (csv-parse's skip_empty_lines only skips physically empty lines; a
    // comma-only line with all blank cells still emits a record.)
    const file = writeCsv(
      "blank.csv",
      "Internal Reference,Variant Values\nA,Size: M\n,\nB,Size: L\n",
    );
    const config: SourceConfig = {
      adapter: "odoo-csv",
      file,
      delimiter: ",",
      encoding: "utf-8",
      pivot: pivotConfig(),
    };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(2);
  });

  it("throws SourceError when `file` is not set", async () => {
    const config = {
      adapter: "odoo-csv",
      delimiter: ",",
      encoding: "utf-8",
    } as SourceConfig;
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });
});

describe("SourceAdapterRegistry (odoo-csv)", () => {
  it("has the odoo-csv adapter registered via the barrel import", () => {
    expect(SourceAdapterRegistry.has("odoo-csv")).toBe(true);
    expect(SourceAdapterRegistry.list()).toContain("odoo-csv");
    expect(SourceAdapterRegistry.get("odoo-csv").id).toBe("odoo-csv");
  });
});
