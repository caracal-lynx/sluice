import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MultiSourcePipelineRunner } from "../../src/index.js";

function yamlPath(p: string): string {
  return p.replace(/\\/g, "/");
}

describe("MultiSourcePipelineRunner", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "sluice-ms-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("runs a multi-source merge end-to-end and writes per-source state", async () => {
    const primaryCsv = join(workDir, "primary.csv");
    const secondaryCsv = join(workDir, "secondary.csv");
    const outputCsv = join(workDir, "merged.csv");

    writeFileSync(
      primaryCsv,
      "STYLE_NO,COST_PRICE,STYLE_DESC\nA,10.00,\nB,20.00,FromSQL\nD,40.00,OnlySQL\n",
      "utf8",
    );
    writeFileSync(
      secondaryCsv,
      "Product Code,STYLE_DESC,FIBRE_CONTENT,COST_PRICE\nA,FromExcelA,Wool,11.00\nB,FromExcelB,,\nC,FromExcelC,Cotton,30.00\n",
      "utf8",
    );

    const pipelineYaml = `
pipeline:
  name: ms-merge
  client: test
  version: "1.0"
  entity: Style
sources:
  - id: primary
    priority: 1
    adapter: csv
    file: ${yamlPath(primaryCsv)}
  - id: secondary
    priority: 2
    adapter: csv
    file: ${yamlPath(secondaryCsv)}
    rename:
      Product Code: STYLE_NO
merge:
  key: STYLE_NO
  strategy: coalesce
  onUnmatched: include
  fieldStrategies:
    - field: FIBRE_CONTENT
      source: secondary
dq:
  stopOnCritical: false
  rules:
    - field: STYLE_NO
      sourceId: primary
      checks:
        - { type: unique, severity: critical }
    - field: STYLE_DESC
      checks:
        - { type: notNull, severity: warning }
transform:
  fields:
    - { from: STYLE_NO, to: StyleNo, type: string }
    - { from: COST_PRICE, to: CostPrice, type: decimal, precision: 2, optional: true }
    - { from: STYLE_DESC, to: StyleDesc, type: string }
    - { from: FIBRE_CONTENT, to: FibreContent, type: string, optional: true }
target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`;

    const yaml = join(workDir, "pipeline.yaml");
    writeFileSync(yaml, pipelineYaml, "utf8");

    const result = await new MultiSourcePipelineRunner().run(yaml);

    expect(result.pipeline).toBe("ms-merge");
    expect(result.extract.tableName).toBe("stg_merged");
    expect(result.extract.rowsExtracted).toBe(6);
    expect(result.load?.rowsLoaded).toBeGreaterThanOrEqual(4);
    expect(existsSync(outputCsv)).toBe(true);

    const output = readFileSync(outputCsv, "utf8");
    expect(output).toContain("StyleNo,CostPrice,StyleDesc,FibreContent");
    expect(output).toContain("A,10.00,FromExcelA,Wool");
    expect(output).toContain("B,20.00,FromSQL,");
    expect(output).toContain("C,30.00,FromExcelC,Cotton");
    expect(output).toContain("D,40.00,OnlySQL,");

    const statePath = join(workDir, "ms-merge-state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    expect(state["rowsMerged"]).toBe(4);
    const sources = state["sources"] as Record<string, { rowsExtracted: number }>;
    expect(sources["primary"]?.rowsExtracted).toBe(3);
    expect(sources["secondary"]?.rowsExtracted).toBe(3);
  });

  it("returns merge summary in dry-run mode without loading target", async () => {
    const one = join(workDir, "dry-one.csv");
    const two = join(workDir, "dry-two.csv");
    const out = join(workDir, "dry-out.csv");

    writeFileSync(one, "ID,VAL\nA,from-one\n", "utf8");
    writeFileSync(two, "ID,VAL\nB,from-two\n", "utf8");

    const yaml = join(workDir, "pipeline-dry-run.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-dry-run
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(one)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(two)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string }
target:
  adapter: csv
  output: ${yamlPath(out)}
  includeHeader: true
run:
  dryRun: true
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);
    expect(result.load).toBeNull();
    expect(result.merge?.rowsMerged).toBe(2);
    expect(result.merge?.unmatched).toBe(2);
  });

  it("fails when onUnmatched=error and unmatched rows exist", async () => {
    const a = join(workDir, "a.csv");
    const b = join(workDir, "b.csv");
    writeFileSync(a, "ID,VAL\nA,1\n", "utf8");
    writeFileSync(b, "ID,VAL\nB,2\n", "utf8");

    const pipelineYaml = `
pipeline:
  name: ms-unmatched
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(a)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(b)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: error
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string }
target:
  adapter: csv
  output: ${yamlPath(join(workDir, "out.csv"))}
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`;
    const yaml = join(workDir, "pipeline.yaml");
    writeFileSync(yaml, pipelineYaml, "utf8");

    await expect(new MultiSourcePipelineRunner().run(yaml)).rejects.toThrow(/unmatched row\(s\)/i);
  });

  it("supports incremental mode by filtering only merge.incrementalSource", async () => {
    const one = join(workDir, "one.csv");
    const two = join(workDir, "two.csv");
    const outputCsv = join(workDir, "merged-incremental.csv");

    writeFileSync(
      one,
      [
        "ID,UPDATED_AT,VAL_ONE",
        "A,2026-01-01T00:00:00.000Z,one-a-old",
        "B,2026-03-01T00:00:00.000Z,one-b-new",
      ].join("\n") + "\n",
      "utf8",
    );
    writeFileSync(two, ["ID,VAL_TWO", "A,two-a", "B,two-b"].join("\n") + "\n", "utf8");

    const since = "2026-02-01T00:00:00.000Z";
    const yaml = join(workDir, "pipeline-incremental.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-incremental
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(one)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(two)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
  incrementalSource: one
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string }
    - { from: VAL_ONE, to: ValOne, type: string, optional: true }
    - { from: VAL_TWO, to: ValTwo, type: string, optional: true }
target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true
run:
  mode: incremental
  incrementalField: UPDATED_AT
  incrementalSince: "${since}"
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);
    expect(result.load?.rowsLoaded).toBe(2);

    const statePath = join(workDir, "ms-incremental-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      sources: Record<string, { rowsExtracted: number; incrementalSince: string }>;
    };
    expect(state.sources.one.rowsExtracted).toBe(1);
    expect(state.sources.one.incrementalSince).toBe(since);
    expect(state.sources.two.rowsExtracted).toBe(2);
    expect(state.sources.two.incrementalSince).toBe("");

    const output = readFileSync(outputCsv, "utf8");
    expect(output).toContain("A,,two-a");
    expect(output).toContain("B,one-b-new,two-b");
  });

  it("fails incremental mode when incrementalField is missing", async () => {
    const one = join(workDir, "one.csv");
    const two = join(workDir, "two.csv");
    writeFileSync(one, "ID,VAL\nA,1\n", "utf8");
    writeFileSync(two, "ID,VAL\nA,2\n", "utf8");

    const yaml = join(workDir, "pipeline-incremental-missing-field.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-incremental-missing-field
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(one)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(two)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
  incrementalSource: one
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string }
target:
  adapter: csv
  output: ${yamlPath(join(workDir, "out.csv"))}
run:
  mode: incremental
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    await expect(new MultiSourcePipelineRunner().run(yaml)).rejects.toThrow(/incrementalField/i);
  });

  it("fails incremental mode when run.incrementalSince is not parseable", async () => {
    const one = join(workDir, "one.csv");
    const two = join(workDir, "two.csv");
    writeFileSync(one, "ID,UPDATED_AT,VAL\nA,2026-03-01T00:00:00.000Z,1\n", "utf8");
    writeFileSync(two, "ID,VAL2\nA,2\n", "utf8");

    const yaml = join(workDir, "pipeline-incremental-bad-since.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-incremental-bad-since
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(one)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(two)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
  incrementalSource: one
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string }
target:
  adapter: csv
  output: ${yamlPath(join(workDir, "out.csv"))}
run:
  mode: incremental
  incrementalField: UPDATED_AT
  incrementalSince: "not-a-timestamp"
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    await expect(new MultiSourcePipelineRunner().run(yaml)).rejects.toThrow(/incrementalSince/i);
  });

  it("fails incremental mode when incrementalField has non-parseable timestamp values", async () => {
    const one = join(workDir, "one.csv");
    const two = join(workDir, "two.csv");
    writeFileSync(one, "ID,UPDATED_AT,VAL\nA,not-a-date,1\nB,2026-03-01T00:00:00.000Z,2\n", "utf8");
    writeFileSync(two, "ID,VAL2\nA,2\nB,3\n", "utf8");

    const yaml = join(workDir, "pipeline-incremental-bad-values.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-incremental-bad-values
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(one)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(two)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
  incrementalSource: one
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string }
target:
  adapter: csv
  output: ${yamlPath(join(workDir, "out.csv"))}
run:
  mode: incremental
  incrementalField: UPDATED_AT
  incrementalSince: "2026-02-01T00:00:00.000Z"
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    await expect(new MultiSourcePipelineRunner().run(yaml)).rejects.toThrow(
      /non-parseable timestamp/i,
    );
  });

  it("runs source-scoped DQ before merge and post-merge DQ after merge in one pipeline", async () => {
    const primaryCsv = join(workDir, "dq-primary.csv");
    const secondaryCsv = join(workDir, "dq-secondary.csv");
    const outputCsv = join(workDir, "dq-output.csv");

    writeFileSync(
      primaryCsv,
      ["ID,NAME", "A,Alpha", "A,Alpha Duplicate", "B,"].join("\n") + "\n",
      "utf8",
    );
    writeFileSync(
      secondaryCsv,
      ["ID,NAME", "A,FromSecondary", "B,FromSecondaryB"].join("\n") + "\n",
      "utf8",
    );

    const yaml = join(workDir, "pipeline-dq-scopes.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-dq-scopes
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(primaryCsv)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(secondaryCsv)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
dq:
  stopOnCritical: false
  rules:
    - field: ID
      sourceId: one
      checks:
        - { type: unique, severity: critical }
    - field: NAME
      checks:
        - { type: notNull, severity: critical }
transform:
  fields:
    - { from: ID, to: Id, type: string }
    - { from: NAME, to: Name, type: string, optional: true }
target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);

    // Source-level unique removes one duplicate from source one before merge.
    // Post-merge notNull then evaluates merged rows (B is filled by source two).
    expect(result.dq.violations.critical).toBe(0);
    expect(result.load?.rowsLoaded).toBe(2);

    const output = readFileSync(outputCsv, "utf8");
    expect(output).toContain("Id,Name");
    expect(output).toContain("A,FromSecondary");
    expect(output).toContain("B,FromSecondaryB");
    expect(output).not.toContain("Alpha Duplicate");

    const statePath = join(workDir, "ms-dq-scopes-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      sources: Record<string, { rowsExtracted: number }>;
    };
    expect(state.sources.one.rowsExtracted).toBe(3);
  });

  it("keeps mixed-format key values distinct without numeric coercion", async () => {
    const one = join(workDir, "key-one.csv");
    const two = join(workDir, "key-two.csv");
    const out = join(workDir, "key-out.csv");

    writeFileSync(one, "ID,VAL\n001,from-one\n", "utf8");
    writeFileSync(two, "ID,VAL\n1,from-two\n", "utf8");

    const yaml = join(workDir, "pipeline-key-format.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-key-format
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(one)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(two)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string }
    - { from: VAL, to: Val, type: string }
target:
  adapter: csv
  output: ${yamlPath(out)}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);
    expect(result.load?.rowsLoaded).toBe(2);

    const output = readFileSync(out, "utf8");
    expect(output).toContain("001,from-one");
    expect(output).toContain("1,from-two");
  });

  it("handles blank join keys without crashing and still merges matching blanks", async () => {
    const one = join(workDir, "blank-one.csv");
    const two = join(workDir, "blank-two.csv");
    const out = join(workDir, "blank-out.csv");

    writeFileSync(one, "ID,VAL\n,from-one-blank\nA,from-one-a\n", "utf8");
    writeFileSync(two, "ID,VAL\n,from-two-blank\nA,from-two-a\n", "utf8");

    const yaml = join(workDir, "pipeline-blank-key.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-blank-key
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(one)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(two)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string, optional: true }
    - { from: VAL, to: Val, type: string }
target:
  adapter: csv
  output: ${yamlPath(out)}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);
    expect(result.load?.rowsLoaded).toBe(2);

    const output = readFileSync(out, "utf8");
    expect(output).toContain(",from-one-blank");
    expect(output).toContain("A,from-one-a");
  });

  it("uses source declaration order as tie-breaker when priorities are duplicated", async () => {
    const one = join(workDir, "dup-priority-one.csv");
    const two = join(workDir, "dup-priority-two.csv");
    const out = join(workDir, "dup-priority-out.csv");

    writeFileSync(one, "ID,VAL\nA,from-one\n", "utf8");
    writeFileSync(two, "ID,VAL\nA,from-two\n", "utf8");

    const yaml = join(workDir, "pipeline-dup-priority.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-dup-priority
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(one)}
  - id: two
    priority: 1
    adapter: csv
    file: ${yamlPath(two)}
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string }
    - { from: VAL, to: Val, type: string }
target:
  adapter: csv
  output: ${yamlPath(out)}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);
    expect(result.load?.rowsLoaded).toBe(1);

    const output = readFileSync(out, "utf8");
    expect(output).toContain("A,from-one");
    expect(output).not.toContain("A,from-two");
  });

  it("handles duplicate rename targets by creating a suffixed column name", async () => {
    const one = join(workDir, "rename-one.csv");
    const two = join(workDir, "rename-two.csv");

    writeFileSync(one, "ID,VAL\nA,from-one\n", "utf8");
    writeFileSync(two, "OLD_A,OLD_B\nA,from-two\n", "utf8");

    const yaml = join(workDir, "pipeline-rename-duplicate.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: ms-rename-duplicate
  client: test
  version: "1.0"
  entity: X
sources:
  - id: one
    priority: 1
    adapter: csv
    file: ${yamlPath(one)}
  - id: two
    priority: 2
    adapter: csv
    file: ${yamlPath(two)}
    rename:
      OLD_A: ID
      OLD_B: ID
merge:
  key: ID
  strategy: coalesce
  onUnmatched: include
dq:
  stopOnCritical: true
  rules: []
transform:
  fields:
    - { from: ID, to: Id, type: string }
target:
  adapter: csv
  output: ${yamlPath(join(workDir, "out.csv"))}
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);
    expect(result.load?.rowsLoaded).toBe(1);
    expect(result.extract.columns.some((c) => c.name === "ID_1")).toBe(true);
  });
});
