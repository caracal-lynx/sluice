/**
 * Guard for the pipelines shipped in `examples/` (DAG-382).
 *
 * The examples go to the public mirror and are the first YAML a new user copies,
 * but nothing ran them: `style-co-style-merge.pipeline.yaml` failed `sluice check`
 * outright (wrong field-mapping keys) and two others carried expressions the
 * engine cannot parse. Every `examples/**\/*.pipeline.yaml` is discovered by
 * glob, so a new example is covered without touching this file.
 *
 * Per example, three checks, each failing with the example's path in the message:
 *   1. The config loads the way `sluice check` loads it (plugins, then
 *      ConfigLoader), with a dummy value for every `${VAR}` it references.
 *   2. No key is silently dropped. Nested schemas strip unknown keys, so a
 *      fictional option (`target.mode`, `run.concurrency`) passes check while
 *      doing nothing; any key in the YAML but absent from the parsed config fails.
 *   3. Every `expression` value compiles: expr-eval for plain expressions, the
 *      JavaScript parser for `js:` ones. `check` does not evaluate them, so a
 *      broken one otherwise surfaces only mid-run.
 *
 * The multi-source merge example is also run end-to-end, with its two database/
 * workbook sources swapped for CSV files and its target for a CSV file. Its merge,
 * DQ and transform blocks are used exactly as shipped.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

import { Parser } from "expr-eval-fork";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRunnerForPipeline } from "../../src/cli.js";
import { ConfigLoader } from "../../src/config/loader.js";
import { MultiSourcePipelineRunner } from "../../src/index.js";

const examplesDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

const examples = readdirSync(examplesDir, { recursive: true, encoding: "utf-8" })
  .filter((f) => f.endsWith(".pipeline.yaml"))
  .map((f) => f.replace(/\\/g, "/"))
  .sort();

const ENV_TOKEN = /\$\{([^}]+)\}/g;

function readExample(rel: string): string {
  return readFileSync(path.join(examplesDir, rel), "utf-8");
}

/** Stubs every `${VAR}` the file references, as a user running `sluice check` would. */
function stubEnvFor(raw: string): void {
  for (const [, name] of raw.matchAll(ENV_TOKEN)) {
    if (name !== undefined) vi.stubEnv(name, `dummy-${name.toLowerCase()}`);
  }
}

/** One line per Zod issue (`transform.fields.0.to: Required`), else the message. */
function errorText(err: unknown): string {
  const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  if (Array.isArray(issues)) {
    return issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

/** Loads a pipeline the way `sluice check` does: the runner's plugins, then ConfigLoader. */
async function loadLikeCheck(file: string): Promise<unknown> {
  const runner = await createRunnerForPipeline(file);
  const ruleIds = await runner.loadPluginsFor(file, []);
  return ConfigLoader.load(file, { rules: ruleIds });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Paths of keys present in `raw` but missing from `parsed` (Zod stripped them). */
function droppedKeys(raw: unknown, parsed: unknown, at = ""): string[] {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    return raw.flatMap((item, i) => droppedKeys(item, parsed[i], `${at}[${i}]`));
  }
  if (!isPlainObject(raw) || !isPlainObject(parsed)) return [];
  return Object.keys(raw).flatMap((key) => {
    const here = at === "" ? key : `${at}.${key}`;
    return key in parsed ? droppedKeys(raw[key], parsed[key], here) : [here];
  });
}

interface ExpressionField {
  to: string;
  value: string;
}

function expressionFields(config: unknown): ExpressionField[] {
  const fields = (config as { transform?: { fields?: unknown[] } }).transform?.fields ?? [];
  return fields.flatMap((f) => {
    const field = f as { type?: unknown; to?: unknown; value?: unknown };
    return field.type === "expression" && typeof field.value === "string"
      ? [{ to: String(field.to), value: field.value }]
      : [];
  });
}

/** Compiles an expression the way ExpressionEvaluator would, without running it. */
function compileExpression(value: string): void {
  if (value.startsWith("js:")) {
    new Script(value.slice(3).trim());
  } else {
    new Parser().parse(value);
  }
}

describe("shipped examples", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("discovers the examples (the glob is not silently empty)", () => {
    expect(examples).toContain("style-co-style-merge.pipeline.yaml");
  });

  describe.each(examples)("examples/%s", (rel) => {
    const file = path.join(examplesDir, rel);

    it("passes sluice check", async () => {
      stubEnvFor(readExample(rel));
      try {
        await loadLikeCheck(file);
      } catch (err) {
        expect.fail(`examples/${rel} fails sluice check: ${errorText(err)}`);
      }
    });

    it("has no keys the schema silently drops", async () => {
      const raw = readExample(rel);
      stubEnvFor(raw);
      const parsed = await loadLikeCheck(file);
      const dropped = droppedKeys(yamlLoad(raw.replace(ENV_TOKEN, "x")), parsed);
      if (dropped.length > 0) {
        expect.fail(`examples/${rel} has keys the schema ignores: ${dropped.join(", ")}`);
      }
    });

    it("has only expressions the engine can compile", async () => {
      stubEnvFor(readExample(rel));
      const broken = expressionFields(await loadLikeCheck(file)).flatMap(({ to, value }) => {
        try {
          compileExpression(value);
          return [];
        } catch (err) {
          return [`${to}: ${errorText(err)}`];
        }
      });
      if (broken.length > 0) {
        expect.fail(`examples/${rel} has expressions that do not compile: ${broken.join("; ")}`);
      }
    });
  });
});

describe("examples/style-co-style-merge.pipeline.yaml end-to-end (CSV stand-ins)", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "sluice-example-merge-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  const IFS_HEADER =
    "style_no,description,colour_code,season_code,unit_cost,target_retail,launch_date,sustainability_notes,best_price_vendor,record_origin";
  const EXCEL_HEADER =
    "STYLE_NO,Colour Code,Season,Best Price Vendor,Sustainability Notes,Description,Cost,Retail,Launch";

  /**
   * The shipped example with only its I/O swapped: the IFS query becomes a CSV
   * with the query's column aliases, the workbook a CSV with the workbook's
   * headers (the shipped `rename` map still applies), and Postgres a CSV file.
   */
  function standIn(ifsRows: string[], excelRows: string[]): { yaml: string; output: string } {
    const config = yamlLoad(
      readExample("style-co-style-merge.pipeline.yaml").replace(ENV_TOKEN, "x"),
    ) as Record<string, unknown> & {
      sources: Record<string, unknown>[];
      merge: Record<string, unknown>;
      dq: Record<string, unknown>;
    };

    const ifsCsv = path.join(workDir, "ifs.csv");
    const excelCsv = path.join(workDir, "excel.csv");
    writeFileSync(ifsCsv, [IFS_HEADER, ...ifsRows].join("\n"), "utf-8");
    writeFileSync(excelCsv, [EXCEL_HEADER, ...excelRows].join("\n"), "utf-8");

    const [ifs, excel] = config.sources;
    expect(ifs?.["id"]).toBe("ifs-master");
    expect(excel?.["id"]).toBe("excel-enrichment");
    config.sources = [
      { id: "ifs-master", priority: ifs?.["priority"], adapter: "csv", file: ifsCsv },
      {
        id: "excel-enrichment",
        priority: excel?.["priority"],
        adapter: "csv",
        file: excelCsv,
        rename: excel?.["rename"],
      },
    ];
    config.merge.conflictLog = path.join(workDir, "conflicts.csv");
    config.dq.rejectionFile = path.join(workDir, "rejected.csv");

    const output = path.join(workDir, "merged.csv");
    config["target"] = { adapter: "csv", output, includeHeader: true };
    config["run"] = { stagingDb: ":memory:", outputDir: workDir };

    const yaml = path.join(workDir, "style-co-style-merge.pipeline.yaml");
    writeFileSync(yaml, yamlDump(config), "utf-8");
    return { yaml, output };
  }

  function readCsv(file: string): Record<string, string>[] {
    const [header, ...lines] = readFileSync(file, "utf-8").trim().split(/\r?\n/);
    const cols = (header ?? "").split(",");
    return lines.map((line) => {
      const cells = line.split(",");
      return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
    });
  }

  it("merges, validates and transforms as the example's comments describe", async () => {
    const { yaml, output } = standIn(
      [
        // Blank IFS description and retail; IFS cost 25.00.
        "AC0001,,101,AW25,25.00,,2026-03-01,,,IFS",
        // Only in IFS; zero retail, so no margin.
        "AC0002,Knitted Hat,202,SS26,5.00,0,2026-04-01,,,IFS",
      ],
      // Excel disagrees on cost and launch, fills retail, description and notes.
      ["AC0001,101,AW25,Vendor A,Recycled wool,Aran Jumper,30.00,89.99,2026-05-01"],
    );

    await new MultiSourcePipelineRunner().run(yaml);

    const rows = readCsv(output);
    expect(rows.map((r) => r["style_no"])).toEqual(["AC0001", "AC0002"]);
    const [both, ifsOnly] = rows;

    // fieldStrategies pin cost and launch date to IFS.
    expect(both?.["unit_cost"]).toBe("25.00");
    expect(both?.["launch_date"]).toMatch(/^2026-03-01/);
    // coalesce fills IFS's blank retail from Excel; enrichment-only columns come through.
    expect(both?.["target_retail"]).toBe("89.99");
    expect(both?.["best_price_vendor"]).toBe("Vendor A");
    expect(both?.["sustainability_notes"]).toBe("Recycled wool");
    // priority-override keeps IFS's blank description (written as `""`) over Excel's.
    expect(both?.["description"]).toBe('""');
    // (89.99 - 25.00) / 89.99 = 72.22% -> 72.2
    expect(both?.["margin_pct"]).toBe("72.2");
    expect(both?.["merge_source"]).toBe("IFS");
    expect(both?.["merged_at"]).toBe("2026-04-15");

    expect(ifsOnly?.["description"]).toBe("Knitted Hat");
    expect(ifsOnly?.["margin_pct"]).toBe("");
    expect(ifsOnly?.["merge_source"]).toBe("IFS");
  });

  it("stops the run on a style that exists only in Excel, which has no IFS cost", async () => {
    const { yaml } = standIn(
      ["AC0001,Aran Jumper,101,AW25,25.00,89.99,2026-03-01,,,IFS"],
      ["AC0009,303,AW25,,,Excel only,12.00,40.00,2026-05-01"],
    );

    await expect(new MultiSourcePipelineRunner().run(yaml)).rejects.toThrow(/halted: 1 critical/i);
    const rejected = readFileSync(path.join(workDir, "rejected.csv"), "utf-8");
    expect(rejected).toContain("unit_cost,,notNull,critical");
  });
});
