/**
 * Phase 12 — single-source prep phase end-to-end.
 *
 * Verifies that prep runs between extract and DQ, that --no-prep skips the
 * phase, that the prep summary JSON is written with the expected shape, and
 * that PrepError surfaces via exitCodeFor as exit code 5.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PipelineRunner } from '../../src/runner.js';
import { PrepError } from '../../src/utils/errors.js';
import { exitCodeFor } from '../../src/cli.js';

function yamlPath(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('Phase 12 — single-source prep', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sluice-prep-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('runs prep between extract and DQ; final output reflects the mutation', async () => {
    // Source has 8-char HC codes that DQ requires to be 10 chars (^\d{10}$).
    // Without prep this fails 3/3 critical. With prep (padEnd:10:0), all pass.
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(
      inputCsv,
      'STYLE_NO,HC_CODE\nABC,61099090\nDEF,62046200\nGHI,01010101\n',
      'utf8',
    );
    const outputCsv = join(workDir, 'output.csv');

    const pipelineYaml = `
pipeline:
  name: prep-padding-test
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ${yamlPath(inputCsv)}
prep:
  rules:
    - field: HC_CODE
      cleanse: padEnd:10:0
dq:
  stopOnCritical: true
  rules:
    - field: HC_CODE
      checks:
        - { type: notNull, severity: critical }
        - { type: pattern, value: "^[0-9]{10}$", severity: critical }
transform:
  fields:
    - { from: STYLE_NO, to: StyleNo, type: string }
    - { from: HC_CODE, to: HsCode, type: string }
target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`;
    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(yaml, pipelineYaml, 'utf8');

    const result = await new PipelineRunner().run(yaml);

    expect(result.dq.violations.critical).toBe(0);
    expect(result.load?.rowsLoaded).toBe(3);

    const output = readFileSync(outputCsv, 'utf8');
    expect(output).toContain('6109909000');
    expect(output).toContain('6204620000');
    expect(output).toContain('0101010100');

    // Prep summary populated on the RunResult.
    expect(result.prepSummary).toBeDefined();
    expect(result.prepSummary!.firings).toHaveLength(1);
    expect(result.prepSummary!.firings[0]!.table).toBe('stg_raw');
    expect(result.prepSummary!.firings[0]!.sourceId).toBeNull();
    expect(result.prepSummary!.firings[0]!.rulesApplied).toBe(1);
    expect(result.prepSummary!.firings[0]!.rules[0]!.rowsChanged).toBe(3);
  });

  it('writes the prep summary JSON to {outputDir}/{name}-prep-summary.json', async () => {
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(inputCsv, 'id,val\n1,foo\n', 'utf8');
    const outputCsv = join(workDir, 'output.csv');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline:
  name: prep-summary-test
  client: t
  version: "1.0"
  entity: T
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
prep:
  rules:
    - field: val
      cleanse: uppercase
dq: { rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
    - { from: val, to: val, type: string }
target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      'utf8',
    );

    const result = await new PipelineRunner().run(yaml);
    const summaryPath = join(workDir, 'prep-summary-test-prep-summary.json');
    expect(existsSync(summaryPath)).toBe(true);

    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
      pipeline: string;
      runAt: string;
      firings: Array<{ table: string; sourceId: string | null; rulesApplied: number }>;
    };
    expect(summary.pipeline).toBe('prep-summary-test');
    expect(summary.firings).toHaveLength(1);
    expect(summary.firings[0]!.table).toBe('stg_raw');
    expect(summary.firings[0]!.sourceId).toBeNull();
    expect(summary.firings[0]!.rulesApplied).toBe(1);
    expect(result.prepSummary).toEqual(summary);
  });

  it('respects an explicit prep.summaryFile path', async () => {
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(inputCsv, 'id,val\n1,foo\n', 'utf8');
    const outputCsv = join(workDir, 'output.csv');
    const summaryFile = join(workDir, 'my-custom-prep-report.json');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline: { name: prep-custom, client: t, version: "1.0", entity: T }
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
prep:
  summaryFile: ${yamlPath(summaryFile)}
  rules: [{ field: val, cleanse: uppercase }]
dq: { rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
    - { from: val, to: val, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`,
      'utf8',
    );

    await new PipelineRunner().run(yaml);
    expect(existsSync(summaryFile)).toBe(true);
    // Default path should NOT exist.
    expect(existsSync(join(workDir, 'prep-custom-prep-summary.json'))).toBe(false);
  });

  it('--no-prep skips the phase; DQ sees raw data, rejection count differs', async () => {
    // Same setup as the first test but with --no-prep (skipPrep). HC codes
    // remain 8 chars → DQ critical pattern fails all rows → run halts.
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(inputCsv, 'STYLE_NO,HC_CODE\nABC,61099090\n', 'utf8');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline: { name: prep-bypass, client: t, version: "1.0", entity: T }
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
prep:
  rules: [{ field: HC_CODE, cleanse: 'padEnd:10:0' }]
dq:
  stopOnCritical: false
  rules:
    - field: HC_CODE
      checks:
        - { type: pattern, value: "^[0-9]{10}$", severity: critical }
transform:
  fields:
    - { from: HC_CODE, to: HsCode, type: string }
target: { adapter: csv, output: ${yamlPath(join(workDir, 'output.csv'))}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`,
      'utf8',
    );

    // With prep ON: 0 critical violations.
    const withPrep = await new PipelineRunner().run(yaml);
    expect(withPrep.dq.violations.critical).toBe(0);
    expect(withPrep.prepSummary).toBeDefined();

    // Clear the summary file written by the first run so we can assert
    // independently that the --no-prep run does not regenerate it.
    const summaryPath = join(workDir, 'prep-bypass-prep-summary.json');
    if (existsSync(summaryPath)) unlinkSync(summaryPath);

    // With prep OFF: 1 critical violation (the raw 8-char HC_CODE fails the pattern).
    const withoutPrep = await new PipelineRunner().run(yaml, { skipPrep: true });
    expect(withoutPrep.dq.violations.critical).toBe(1);
    expect(withoutPrep.prepSummary).toBeUndefined();
    expect(existsSync(summaryPath)).toBe(false);
  });

  it('PrepError on unknown column → exit code 5 via exitCodeFor', async () => {
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(inputCsv, 'id\n1\n', 'utf8');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline: { name: prep-bad-col, client: t, version: "1.0", entity: T }
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
prep:
  rules: [{ field: NOT_A_COLUMN, cleanse: uppercase }]
dq: { rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
target: { adapter: csv, output: ${yamlPath(join(workDir, 'output.csv'))}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`,
      'utf8',
    );

    let caught: unknown;
    try {
      await new PipelineRunner().run(yaml);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrepError);
    expect(exitCodeFor(caught)).toBe(5);
  });

  it('prep runs in validate-only mode (DQ depends on its output)', async () => {
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(inputCsv, 'id,val\n1,foo\n', 'utf8');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline: { name: prep-validate, client: t, version: "1.0", entity: T }
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
prep:
  rules: [{ field: val, cleanse: uppercase }]
dq: { rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
    - { from: val, to: val, type: string }
target: { adapter: csv, output: ${yamlPath(join(workDir, 'output.csv'))}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yamlPath(workDir)}, mode: validate-only }
`,
      'utf8',
    );

    const result = await new PipelineRunner().run(yaml, { mode: 'validate-only' });
    expect(result.prepSummary).toBeDefined();
    expect(result.load).toBeNull(); // validate-only skips load
    expect(existsSync(join(workDir, 'prep-validate-prep-summary.json'))).toBe(true);
  });
});
