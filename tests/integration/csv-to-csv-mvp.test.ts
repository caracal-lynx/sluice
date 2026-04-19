/**
 * MVP milestone — csv → csv pipeline runs end-to-end.
 *
 * This verifies Phase 4's vertical slice: staging store + CSV source +
 * CSV target + runner skeleton + minimal CLI wiring. Stubs in the runner
 * (runDQ, runTransform, writeStateFile) behave as pass-throughs so the
 * integration surfaces only the real glue.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PipelineRunner } from '../../src/runner.js';

function yamlPath(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('MVP: csv → csv end-to-end', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sluice-mvp-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('runs an identity CSV → CSV pipeline', async () => {
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(inputCsv, 'id,name\n1,Alice\n2,Bob\n3,Charlie\n', 'utf8');
    const outputCsv = join(workDir, 'output.csv');

    const pipelineYaml = `
pipeline:
  name: mvp-test
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ${yamlPath(inputCsv)}
dq:
  stopOnCritical: false
  rules: []
transform:
  fields:
    - { from: id, to: id, type: string }
    - { from: name, to: name, type: string }
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

    const runner = new PipelineRunner();
    const result = await runner.run(yaml);

    expect(result.pipeline).toBe('mvp-test');
    expect(result.mode).toBe('full');
    expect(result.extract.rowsExtracted).toBe(3);
    expect(result.extract.tableName).toBe('stg_raw');
    expect(result.load?.rowsLoaded).toBe(3);
    expect(result.load?.outputPath).toBeTruthy();

    const output = readFileSync(outputCsv, 'utf8');
    expect(output).toContain('id,name');
    expect(output).toContain('1,Alice');
    expect(output).toContain('2,Bob');
    expect(output).toContain('3,Charlie');
  });

  it('dryRun stops before load and writes no output', async () => {
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(inputCsv, 'id,name\n1,a\n', 'utf8');
    const outputCsv = join(workDir, 'output.csv');

    const pipelineYaml = `
pipeline:
  name: mvp-dry
  client: test
  version: "1.0"
  entity: Test
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
dq:    { stopOnCritical: false, rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run:    { dryRun: true, outputDir: ${yamlPath(workDir)} }
`;
    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(yaml, pipelineYaml, 'utf8');

    const result = await new PipelineRunner().run(yaml);
    expect(result.load).toBeNull();
    expect(result.transform).toBeNull();
    // Output file must not exist
    expect(() => readFileSync(outputCsv, 'utf8')).toThrow();
  });

  it('validate-only stops before load, same as dryRun path', async () => {
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(inputCsv, 'id,name\n1,a\n', 'utf8');
    const outputCsv = join(workDir, 'output.csv');

    const pipelineYaml = `
pipeline:
  name: mvp-validate
  client: test
  version: "1.0"
  entity: Test
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
dq:    { stopOnCritical: false, rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run:    { mode: validate-only, stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`;
    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(yaml, pipelineYaml, 'utf8');

    const result = await new PipelineRunner().run(yaml);
    expect(result.mode).toBe('validate-only');
    expect(result.load).toBeNull();
  });

  it('rejects incremental mode with ConfigError', async () => {
    const inputCsv = join(workDir, 'input.csv');
    writeFileSync(inputCsv, 'id,name\n1,a\n', 'utf8');
    const outputCsv = join(workDir, 'output.csv');
    const pipelineYaml = `
pipeline:
  name: mvp-incr
  client: test
  version: "1.0"
  entity: Test
source: { adapter: csv, file: ${yamlPath(inputCsv)} }
dq:    { stopOnCritical: false, rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true }
run:    { mode: incremental, stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`;
    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(yaml, pipelineYaml, 'utf8');

    await expect(new PipelineRunner().run(yaml)).rejects.toThrow(/incremental/i);
  });

  it('uses custom delimiter end-to-end', async () => {
    const inputCsv = join(workDir, 'input.psv');
    writeFileSync(inputCsv, 'id|name\n1|a\n2|b\n', 'utf8');
    const outputCsv = join(workDir, 'output.psv');

    const pipelineYaml = `
pipeline:
  name: mvp-pipe
  client: test
  version: "1.0"
  entity: Test
source: { adapter: csv, file: ${yamlPath(inputCsv)}, delimiter: "|" }
dq:    { stopOnCritical: false, rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
    - { from: name, to: name, type: string }
target: { adapter: csv, output: ${yamlPath(outputCsv)}, includeHeader: true, delimiter: "|" }
run:    { stagingDb: ":memory:", outputDir: ${yamlPath(workDir)} }
`;
    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(yaml, pipelineYaml, 'utf8');

    const result = await new PipelineRunner().run(yaml);
    expect(result.load?.rowsLoaded).toBe(2);
    const output = readFileSync(outputCsv, 'utf8');
    expect(output).toContain('id|name');
    expect(output).toContain('1|a');
    expect(output).toContain('2|b');
  });
});
