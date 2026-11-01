/**
 * DAG-381 — incremental mode's watermark tracks the data, not the clock.
 *
 * Legacy sources carry dates far behind the wall-clock time of the machine
 * running Sluice. The state file used to record `lastRunAt: new Date()`, and the
 * next run filtered `incrementalField >= lastRunAt`, so every new row dated
 * before "now" was silently dropped with a clean exit.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MultiSourcePipelineRunner } from "../../src/multi-source-runner.js";
import { PipelineRunner } from "../../src/runner.js";

function yamlPath(p: string): string {
  return p.replace(/\\/g, "/");
}

interface SingleState {
  lastRunAt: string;
  watermark?: string;
  incrementalSince: string;
  rowsExtracted: number;
}

interface MultiState {
  sources: Record<string, { lastRunAt: string; watermark?: string; rowsExtracted: number }>;
}

describe("incremental watermark (DAG-381)", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "sluice-watermark-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function writeSinglePipeline(name: string, inputCsv: string, outputCsv: string): string {
    const yaml = join(workDir, `${name}.yaml`);
    writeFileSync(
      yaml,
      `
pipeline:
  name: ${name}
  client: test
  version: "1.0"
  entity: Test
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
dq:    { stopOnCritical: false, rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
    - { from: name, to: name, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run:
  mode: incremental
  incrementalField: updated_at
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );
    return yaml;
  }

  function readState<T>(name: string): T {
    return JSON.parse(readFileSync(join(workDir, `${name}-state.json`), "utf8")) as T;
  }

  it("picks up a new row dated before the wall-clock time of the previous run", async () => {
    const inputCsv = join(workDir, "input.csv");
    const outputCsv = join(workDir, "output.csv");
    const yaml = writeSinglePipeline("wm-single", inputCsv, outputCsv);

    // Run 1: legacy dates, years behind the machine's clock.
    writeFileSync(
      inputCsv,
      "id,updated_at,name\n1,2026-01-01T00:00:00.000Z,a\n2,2026-01-02T00:00:00.000Z,b\n",
      "utf8",
    );
    const first = await new PipelineRunner().run(yaml);
    expect(first.extract.rowsExtracted).toBe(2);

    const afterFirst = readState<SingleState>("wm-single");
    expect(afterFirst.watermark).toMatch(/^2026-01-02[ T]00:00:00/);
    // lastRunAt stays what its name says: when the run happened.
    expect(afterFirst.lastRunAt).not.toMatch(/^2026-01-02/);

    // Run 2: one new row, newer than anything seen, still long before "now".
    writeFileSync(
      inputCsv,
      "id,updated_at,name\n" +
        "1,2026-01-01T00:00:00.000Z,a\n" +
        "2,2026-01-02T00:00:00.000Z,b\n" +
        "3,2026-01-03T00:00:00.000Z,c\n",
      "utf8",
    );
    const second = await new PipelineRunner().run(yaml);

    // >= keeps the boundary row (2) so a late write at the same timestamp isn't lost;
    // row 1 is filtered out; row 3 is the one the old code silently dropped.
    expect(second.extract.rowsExtracted).toBe(2);
    const output = readFileSync(outputCsv, "utf8");
    expect(output).toContain("3,c");
    expect(output).not.toContain("1,a");

    const afterSecond = readState<SingleState>("wm-single");
    expect(afterSecond.incrementalSince).toBe(afterFirst.watermark);
    expect(afterSecond.watermark).toMatch(/^2026-01-03[ T]00:00:00/);
  });

  it("keeps the previous watermark when a run extracts nothing", async () => {
    const inputCsv = join(workDir, "input.csv");
    const outputCsv = join(workDir, "output.csv");
    const yaml = writeSinglePipeline("wm-empty", inputCsv, outputCsv);

    writeFileSync(inputCsv, "id,updated_at,name\n1,2026-01-05T00:00:00.000Z,a\n", "utf8");
    await new PipelineRunner().run(yaml);
    const before = readState<SingleState>("wm-empty").watermark;
    expect(before).toMatch(/^2026-01-05/);

    // Only an older row: nothing passes the filter.
    writeFileSync(inputCsv, "id,updated_at,name\n1,2026-01-01T00:00:00.000Z,a\n", "utf8");
    const empty = await new PipelineRunner().run(yaml);
    expect(empty.extract.rowsExtracted).toBe(0);
    // Falling back to the clock here would recreate the bug on the next run.
    expect(readState<SingleState>("wm-empty").watermark).toBe(before);
  });

  it("re-extracts once from a pre-DAG-381 state file that only has lastRunAt", async () => {
    const inputCsv = join(workDir, "input.csv");
    const outputCsv = join(workDir, "output.csv");
    const yaml = writeSinglePipeline("wm-legacy", inputCsv, outputCsv);

    writeFileSync(
      inputCsv,
      "id,updated_at,name\n1,2026-01-01T00:00:00.000Z,a\n2,2026-01-02T00:00:00.000Z,b\n",
      "utf8",
    );
    // The shape the old runner wrote: a wall-clock lastRunAt ahead of every source row.
    writeFileSync(
      join(workDir, "wm-legacy-state.json"),
      JSON.stringify({ pipeline: "wm-legacy", lastRunAt: "2026-09-15T06:19:00.831Z" }),
      "utf8",
    );

    const result = await new PipelineRunner().run(yaml);
    expect(result.extract.rowsExtracted).toBe(2);
    expect(readState<SingleState>("wm-legacy").watermark).toMatch(/^2026-01-02/);
  });

  it("tracks the incremental source's watermark in a multi-source pipeline", async () => {
    const one = join(workDir, "one.csv");
    const two = join(workDir, "two.csv");
    const outputCsv = join(workDir, "ms-output.csv");
    writeFileSync(two, "ID,VAL_TWO\nA,two-a\nB,two-b\nC,two-c\n", "utf8");

    const yaml = join(workDir, "wm-multi.yaml");
    writeFileSync(
      yaml,
      `
pipeline:
  name: wm-multi
  client: test
  version: "1.0"
  entity: X
sources:
  - { id: one, priority: 1, adapter: csv, file: ${yamlPath(one)} }
  - { id: two, priority: 2, adapter: csv, file: ${yamlPath(two)} }
merge:
  key: ID
  strategy: coalesce
  onUnmatched: exclude
  incrementalSource: one
dq: { stopOnCritical: true, rules: [] }
transform:
  fields:
    - { from: ID, to: Id, type: string }
    - { from: VAL_ONE, to: ValOne, type: string, optional: true }
    - { from: VAL_TWO, to: ValTwo, type: string, optional: true }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run:
  mode: incremental
  incrementalField: UPDATED_AT
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      "utf8",
    );

    writeFileSync(
      one,
      "ID,UPDATED_AT,VAL_ONE\nA,2026-01-01T00:00:00.000Z,one-a\nB,2026-01-02T00:00:00.000Z,one-b\n",
      "utf8",
    );
    await new MultiSourcePipelineRunner().run(yaml);
    const afterFirst = readState<MultiState>("wm-multi");
    expect(afterFirst.sources["one"]?.watermark).toMatch(/^2026-01-02[ T]00:00:00/);
    // Only the incremental source carries a watermark.
    expect(afterFirst.sources["two"]?.watermark).toBeUndefined();

    writeFileSync(
      one,
      "ID,UPDATED_AT,VAL_ONE\n" +
        "A,2026-01-01T00:00:00.000Z,one-a\n" +
        "B,2026-01-02T00:00:00.000Z,one-b\n" +
        "C,2026-01-03T00:00:00.000Z,one-c\n",
      "utf8",
    );
    await new MultiSourcePipelineRunner().run(yaml);

    const output = readFileSync(outputCsv, "utf8");
    expect(output).toContain("C,one-c,two-c");
    expect(output).not.toContain("A,one-a");
    expect(readState<MultiState>("wm-multi").sources["one"]?.watermark).toMatch(/^2026-01-03/);
  });
});
