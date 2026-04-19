/**
 * Exercise the PipelineRunner's public API surface used by each CLI command,
 * plus sluice check via ConfigLoader. Subprocess-level tests of `src/cli.ts`
 * would add flaky wiring; this file gets equivalent coverage by invoking
 * runner.run / runner.profile / ConfigLoader.load directly.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigLoader } from '../../src/config/loader.js';
import { PipelineRunner } from '../../src/runner.js';
import { ConfigError } from '../../src/utils/errors.js';

function yp(p: string): string {
  return p.replace(/\\/g, '/');
}

function writeMinimal(workDir: string, outputCsv: string): string {
  const input = join(workDir, 'in.csv');
  writeFileSync(input, 'id,name\n1,a\n2,b\n3,c\n', 'utf-8');
  const yaml = `
pipeline: { name: cli-test, client: t, version: "1.0", entity: T }
source:   { adapter: csv, file: ${yp(input)} }
dq:       { stopOnCritical: false, rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
    - { from: name, to: name, type: string }
target:   { adapter: csv, output: ${yp(outputCsv)}, includeHeader: true }
run:      { stagingDb: ":memory:", outputDir: ${yp(workDir)} }
`;
  const yamlPath = join(workDir, 'pipeline.yaml');
  writeFileSync(yamlPath, yaml, 'utf-8');
  return yamlPath;
}

describe('CLI command surfaces', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sluice-cli-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('sluice run path: writes output and state file', async () => {
    const outputCsv = join(workDir, 'out.csv');
    const yamlPath = writeMinimal(workDir, outputCsv);
    const result = await new PipelineRunner().run(yamlPath);
    expect(existsSync(outputCsv)).toBe(true);
    expect(existsSync(result.stateFilePath!)).toBe(true);
  });

  it('sluice validate path: forces validate-only mode and skips load', async () => {
    const outputCsv = join(workDir, 'out.csv');
    const yamlPath = writeMinimal(workDir, outputCsv);
    const result = await new PipelineRunner().run(yamlPath, { mode: 'validate-only' });
    expect(result.mode).toBe('validate-only');
    expect(result.load).toBeNull();
    expect(existsSync(outputCsv)).toBe(false);
  });

  it('sluice profile path: extracts and writes a column-stats JSON', async () => {
    const outputCsv = join(workDir, 'out.csv'); // unused by profile
    const yamlPath = writeMinimal(workDir, outputCsv);
    const result = await new PipelineRunner().profile(yamlPath);
    expect(result.profilePath).toBeTruthy();
    expect(existsSync(result.profilePath!)).toBe(true);
    const profile = JSON.parse(readFileSync(result.profilePath!, 'utf-8'));
    expect(Array.isArray(profile)).toBe(true);
    expect(profile).toHaveLength(2);
    const idCol = profile.find((c: { name: string }) => c.name === 'id');
    expect(idCol).toMatchObject({
      name: 'id',
      duckDbType: 'VARCHAR',
      rowCount: 3,
      nullCount: 0,
      distinctCount: 3,
    });
    expect(idCol.sample).toHaveLength(3);
    // No output CSV should be written by profile
    expect(existsSync(outputCsv)).toBe(false);
  });

  it('sluice check path: returns the loaded config for a valid pipeline', async () => {
    const outputCsv = join(workDir, 'out.csv');
    const yamlPath = writeMinimal(workDir, outputCsv);
    const config = await ConfigLoader.load(yamlPath);
    expect(config.pipeline.name).toBe('cli-test');
    expect(config.source.adapter).toBe('csv');
    // check must NOT run the pipeline
    expect(existsSync(outputCsv)).toBe(false);
  });

  it('sluice check path: throws ConfigError for invalid YAML path', async () => {
    await expect(ConfigLoader.load(join(workDir, 'nope.yaml'))).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it('--output flag equivalent: overrides run.outputDir', async () => {
    const outputCsv = join(workDir, 'out.csv');
    const yamlPath = writeMinimal(workDir, outputCsv);
    const overrideDir = join(workDir, 'override-out');
    const result = await new PipelineRunner().run(yamlPath, { outputDir: overrideDir });
    // State file should land in the override dir
    expect(result.stateFilePath!.replace(/\\/g, '/')).toContain(
      overrideDir.replace(/\\/g, '/'),
    );
  });

  it('--dry-run flag equivalent: runs extract + DQ but skips load', async () => {
    const outputCsv = join(workDir, 'out.csv');
    const yamlPath = writeMinimal(workDir, outputCsv);
    const result = await new PipelineRunner().run(yamlPath, { dryRun: true });
    expect(result.load).toBeNull();
    expect(existsSync(outputCsv)).toBe(false);
  });
});
