/**
 * Integration tests for DQ wiring through PipelineRunner.
 *
 * Verifies that critical DQ violations with `stopOnCritical: true` abort the
 * pipeline with PipelineDQError, and that rejection/summary files land where
 * the spec says they should.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PipelineRunner } from "../../src/runner.js";
import { PipelineDQError } from "../../src/utils/errors.js";

function yamlPath(p: string): string {
  return p.replace(/\\/g, "/");
}

describe("DQ integration: stopOnCritical + reporter output", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "sluice-dq-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("throws PipelineDQError on critical violations when stopOnCritical is true", async () => {
    const inputCsv = join(workDir, "input.csv");
    writeFileSync(inputCsv, "CUST_CODE,CUST_NAME\nA001,Alice\nA001,Bob\n,NoCode\n", "utf8");
    const outputCsv = join(workDir, "output.csv");

    const pipelineYaml = `
pipeline:
  name: dq-stop
  client: test
  version: "1.0"
  entity: Test
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
dq:
  stopOnCritical: true
  rules:
    - field: CUST_CODE
      checks:
        - { type: notNull, severity: critical }
        - { type: unique, severity: critical }
transform:
  fields:
    - { from: CUST_CODE, to: CustomerNo, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`;
    const yaml = join(workDir, "pipeline.yaml");
    writeFileSync(yaml, pipelineYaml, "utf8");

    await expect(new PipelineRunner().run(yaml)).rejects.toBeInstanceOf(PipelineDQError);

    // Reports must be written before the throw
    const summaryPath = join(workDir, "dq-stop-dq-summary.json");
    expect(existsSync(summaryPath)).toBe(true);
    const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
    expect(summary.violations.critical).toBeGreaterThan(0);
    expect(summary.rowsRejected).toBeGreaterThan(0);

    const rejectedPath = join(workDir, "dq-stop-rejected.csv");
    expect(existsSync(rejectedPath)).toBe(true);
    const rejected = readFileSync(rejectedPath, "utf-8");
    expect(rejected).toContain("row_index,field,value,rule,severity,message");
    expect(rejected).toContain("unique");

    // Output CSV must NOT exist (pipeline halted before load)
    expect(existsSync(outputCsv)).toBe(false);
  });

  it("continues through load when stopOnCritical is false", async () => {
    const inputCsv = join(workDir, "input.csv");
    writeFileSync(inputCsv, "CUST_CODE,CUST_NAME\nA001,Alice\nA001,Bob\nB002,Bea\n", "utf8");
    const outputCsv = join(workDir, "output.csv");

    const pipelineYaml = `
pipeline:
  name: dq-warn
  client: test
  version: "1.0"
  entity: Test
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
dq:
  stopOnCritical: false
  rules:
    - field: CUST_CODE
      checks:
        - { type: unique, severity: critical }
transform:
  fields:
    - { from: CUST_CODE, to: CustomerNo, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`;
    const yaml = join(workDir, "pipeline.yaml");
    writeFileSync(yaml, pipelineYaml, "utf8");

    const result = await new PipelineRunner().run(yaml);
    expect(result.dq.violations.critical).toBeGreaterThan(0);
    expect(result.dq.rowsRejected).toBe(2);
    expect(result.load).not.toBeNull();
    expect(existsSync(outputCsv)).toBe(true);
    const output = readFileSync(outputCsv, "utf-8");
    expect(output).toContain("CustomerNo");
    expect(output).toContain("B002");
    expect(output).not.toContain("A001");
  });

  it("keeps warning-only rows in the output", async () => {
    const inputCsv = join(workDir, "input.csv");
    writeFileSync(inputCsv, "CUST_CODE,CUST_NAME\nA001,Alice\nA001,Bob\nB002,Bea\n", "utf8");
    const outputCsv = join(workDir, "output.csv");

    const pipelineYaml = `
pipeline:
  name: dq-warning-pass
  client: test
  version: "1.0"
  entity: Test
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
dq:
  stopOnCritical: false
  rules:
    - field: CUST_CODE
      checks:
        - { type: unique, severity: warning }
transform:
  fields:
    - { from: CUST_CODE, to: CustomerNo, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`;
    const yaml = join(workDir, "pipeline.yaml");
    writeFileSync(yaml, pipelineYaml, "utf8");

    const result = await new PipelineRunner().run(yaml);
    expect(result.dq.violations.warning).toBeGreaterThan(0);
    expect(result.dq.rowsRejected).toBe(0);
    const output = readFileSync(outputCsv, "utf-8");
    expect(output).toContain("A001");
    expect(output).toContain("B002");
  });

  it("writes a custom rejection file when dq.rejectionFile is set", async () => {
    const inputCsv = join(workDir, "input.csv");
    writeFileSync(inputCsv, "X\nA\nA\n", "utf8");
    const outputCsv = join(workDir, "output.csv");
    const customRejections = join(workDir, "my-rejections.csv");

    const pipelineYaml = `
pipeline: { name: dq-custom, client: test, version: "1.0", entity: Test }
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
dq:
  stopOnCritical: false
  rejectionFile: ${yamlPath(customRejections)}
  rules:
    - field: X
      checks:
        - { type: unique, severity: warning }
transform:
  fields:
    - { from: X, to: X, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`;
    const yaml = join(workDir, "pipeline.yaml");
    writeFileSync(yaml, pipelineYaml, "utf8");

    await new PipelineRunner().run(yaml);
    expect(existsSync(customRejections)).toBe(true);
    expect(readFileSync(customRejections, "utf-8")).toContain("unique");
  });
});
