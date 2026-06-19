import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../../../src/adapters/source/index.js"; // ensure built-in adapters are registered
import { PrepLookupResolver } from "../../../src/prep/lookup.js";
import { LookupResolver } from "../../../src/transform/lookup.js";
import { PrepError } from "../../../src/utils/errors.js";
import { RunSchema } from "../../../src/config/schema.js";
import type { Lookup, RunConfig } from "../../../src/config/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixtureCsv = path.resolve(__dirname, "../../fixtures/lookups/hc-code-fixups.csv");

const runConfig: RunConfig = RunSchema.parse({});

const hcCodeLookup: Lookup = {
  name: "hcCodeFixups",
  source: { adapter: "csv", file: fixtureCsv, delimiter: ",", encoding: "utf-8" },
  key: "invalid_code",
  value: "valid_code",
};

describe("PrepLookupResolver", () => {
  let resolver: PrepLookupResolver;

  beforeEach(() => {
    resolver = new PrepLookupResolver();
  });

  it("loads a CSV-backed lookup into the cache", async () => {
    await resolver.loadAll([hcCodeLookup], runConfig);
    const table = resolver.getTable("hcCodeFixups");
    expect(table).toBeDefined();
    expect(table!.size).toBe(3);
    expect(table!.get("6109909000")).toBe("6109100090");
    expect(table!.get("0000000000")).toBe("6109100090");
  });

  it("resolve() returns the cached value on hit", async () => {
    await resolver.loadAll([hcCodeLookup], runConfig);
    expect(resolver.resolve("hcCodeFixups", "6109909000")).toBe("6109100090");
    expect(resolver.resolve("hcCodeFixups", "6204620000")).toBe("6204623900");
  });

  it("resolve() returns undefined on miss", async () => {
    await resolver.loadAll([hcCodeLookup], runConfig);
    expect(resolver.resolve("hcCodeFixups", "not-in-table")).toBeUndefined();
  });

  it("resolve() returns undefined for null/empty key without throwing", async () => {
    await resolver.loadAll([hcCodeLookup], runConfig);
    expect(resolver.resolve("hcCodeFixups", null)).toBeUndefined();
    expect(resolver.resolve("hcCodeFixups", undefined)).toBeUndefined();
    expect(resolver.resolve("hcCodeFixups", "")).toBeUndefined();
  });

  it("resolve() throws PrepError for an unknown lookup name", async () => {
    await resolver.loadAll([hcCodeLookup], runConfig);
    expect(() => resolver.resolve("not-loaded", "6109909000")).toThrow(PrepError);
  });

  it("loadAll() throws PrepError on duplicate lookup names", async () => {
    await expect(resolver.loadAll([hcCodeLookup, hcCodeLookup], runConfig)).rejects.toThrow(
      PrepError,
    );
  });

  it("coerces non-string keys/values to strings", async () => {
    await resolver.loadAll([hcCodeLookup], runConfig);
    // CSV values are already strings, but resolve() must accept numeric keys too.
    expect(resolver.resolve("hcCodeFixups", 6109909000)).toBe("6109100090");
  });
});

describe("isolation between PrepLookupResolver and transform.LookupResolver", () => {
  it("a prep resolver and a transform resolver hold independent caches", async () => {
    // Build a transform.LookupResolver via its public API. It expects a full
    // Pipeline-shaped config object with `transform.lookups`; we only need
    // the lookup-loading path.
    const txResolver = new LookupResolver();
    const pipeline = {
      transform: { lookups: [hcCodeLookup] },
    } as unknown as Parameters<LookupResolver["loadAll"]>[0];

    await txResolver.loadAll(pipeline, runConfig);
    const prep = new PrepLookupResolver();
    await prep.loadAll([hcCodeLookup], runConfig);

    // Both caches contain the same data but they are NOT the same instance.
    const txTable = txResolver.getTable("hcCodeFixups");
    const prepTable = prep.getTable("hcCodeFixups");
    expect(txTable).toBeDefined();
    expect(prepTable).toBeDefined();
    expect(txTable).not.toBe(prepTable);
    expect(txTable!.get("6109909000")).toBe(prepTable!.get("6109909000"));
  });
});
