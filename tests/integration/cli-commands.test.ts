/**
 * Exercise the PipelineRunner's public API surface used by each CLI command,
 * plus sluice check via ConfigLoader. Subprocess-level tests of `src/cli.ts`
 * would add flaky wiring; this file gets equivalent coverage by invoking
 * runner.run / runner.profile / ConfigLoader.load directly.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildProgram, createRunnerForPipeline } from '../../src/cli.js';
import { ConfigLoader } from '../../src/config/loader.js';
import { isSingleSource } from '../../src/config/schema.js';
import { MultiSourcePipelineRunner } from '../../src/multi-source-runner.js';
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
    expect(result.transform).not.toBeNull();
    expect(result.transform?.rowsIn).toBe(3);
    expect(result.transform?.rowsOut).toBe(3);
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

  it('sluice profile path: supports incremental mode with incrementalField', async () => {
    const input = join(workDir, 'profile-incremental.csv');
    writeFileSync(
      input,
      [
        'id,updated_at,name',
        '1,2026-01-01T00:00:00.000Z,old-a',
        '2,2026-03-01T00:00:00.000Z,new-b',
      ].join('\n') + '\n',
      'utf-8',
    );
    const outputCsv = join(workDir, 'unused.csv');
    const yamlPath = join(workDir, 'profile-incremental.pipeline.yaml');
    writeFileSync(
      yamlPath,
      `
pipeline: { name: cli-profile-incremental, client: t, version: "1.0", entity: T }
source:   { adapter: csv, file: ${yp(input)} }
dq:       { stopOnCritical: false, rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
target:   { adapter: csv, output: ${yp(outputCsv)}, includeHeader: true }
run:
  mode: incremental
  incrementalField: updated_at
  incrementalSince: "2026-02-01T00:00:00.000Z"
  stagingDb: ":memory:"
  outputDir: ${yp(workDir)}
`,
      'utf-8',
    );

    const result = await new PipelineRunner().profile(yamlPath);

    expect(result.extract.rowsExtracted).toBe(1);
    const profile = JSON.parse(readFileSync(result.profilePath!, 'utf-8'));
    const idCol = profile.find((c: { name: string }) => c.name === 'id');
    expect(idCol).toMatchObject({ rowCount: 1, distinctCount: 1 });
  });

  it('sluice profile path: rejects incremental mode when incrementalField is missing', async () => {
    const outputCsv = join(workDir, 'out.csv');
    const yamlPath = writeMinimal(workDir, outputCsv);

    await expect(new PipelineRunner().profile(yamlPath, { mode: 'incremental' })).rejects.toThrow(
      /incrementalField/i,
    );
  });

  it('sluice check path: returns the loaded config for a valid pipeline', async () => {
    const outputCsv = join(workDir, 'out.csv');
    const yamlPath = writeMinimal(workDir, outputCsv);
    const config = await ConfigLoader.load(yamlPath);
    expect(config.pipeline.name).toBe('cli-test');
    expect(isSingleSource(config) && config.source.adapter).toBe('csv');
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
    expect(result.transform).not.toBeNull();
    expect(result.transform?.rowsIn).toBe(3);
    expect(result.transform?.rowsOut).toBe(3);
    expect(result.load).toBeNull();
    expect(existsSync(outputCsv)).toBe(false);
  });

  it('registers Batch 25 CLI commands for plugins and merge strategy introspection', () => {
    const program = buildProgram();
    const topLevelCommands = program.commands.map((c) => c.name());
    const globalOptions = program.options.map((o) => o.long);

    expect(topLevelCommands).toContain('plugins');
    expect(topLevelCommands).toContain('merge');
    expect(globalOptions).toContain('--plugins');

    const merge = program.commands.find((c) => c.name() === 'merge');
    expect(merge).toBeDefined();

    const mergeSubcommands = merge!.commands.map((c) => c.name());
    expect(mergeSubcommands).toContain('list-strategies');
    expect(mergeSubcommands).toContain('info');
  });
});

describe('CLI multi-source handling', () => {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const fixturesDir = path.resolve(__dirname, '../fixtures');
  const multiSourceFixture = path.join(fixturesDir, 'style-co-products-merged.pipeline.yaml');
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sluice-cli-ms-suite-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('sluice check accepts a valid multi-source pipeline', async () => {
    // Substitute env vars that ConfigLoader would normally resolve
    const raw = await import('node:fs').then(fs =>
      fs.readFileSync(multiSourceFixture, 'utf-8')
        .replace(/\$\{[^}]+\}/g, 'placeholder'),
    );
    const tmpYaml = path.join(tmpdir(), 'style-co-products-merged-test.pipeline.yaml');
    writeFileSync(tmpYaml, raw, 'utf-8');

    const config = await ConfigLoader.load(tmpYaml);
    expect(config.pipeline.name).toBe('style-co-products-merged');
    expect(config.sources).toHaveLength(3);
    expect(config.merge?.key).toBe('STYLE_NO');
  });

  it('createRunnerForPipeline selects MultiSourcePipelineRunner for multi-source config', async () => {
    const raw = await import('node:fs').then(fs =>
      fs.readFileSync(multiSourceFixture, 'utf-8')
        .replace(/\$\{[^}]+\}/g, 'placeholder'),
    );
    const tmpYaml = path.join(tmpdir(), 'style-co-products-merged-run-test.pipeline.yaml');
    writeFileSync(tmpYaml, raw, 'utf-8');

    const runner = await createRunnerForPipeline(tmpYaml);
    expect(runner).toBeInstanceOf(MultiSourcePipelineRunner);
  });

  it('sluice profile runs against merged multi-source data via selected runner', async () => {
    const a = join(workDir, 'profile-a.csv');
    const b = join(workDir, 'profile-b.csv');
    const tmpYaml = join(workDir, 'profile-ms.pipeline.yaml');

    writeFileSync(a, 'ID,NAME\nA,FromA\nB,OnlyA\n', 'utf-8');
    writeFileSync(b, 'ID,NAME\nA,FromB\nC,OnlyB\n', 'utf-8');
    writeFileSync(
      tmpYaml,
      `
pipeline: { name: cli-ms-profile, client: t, version: "1.0", entity: T }
sources:
  - { id: one, priority: 1, adapter: csv, file: ${yp(a)} }
  - { id: two, priority: 2, adapter: csv, file: ${yp(b)} }
merge: { key: ID, strategy: coalesce, onUnmatched: include }
dq: { stopOnCritical: true, rules: [] }
transform:
  fields:
    - { from: ID, to: Id, type: string }
target: { adapter: csv, output: ${yp(join(workDir, 'unused.csv'))}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yp(workDir)} }
`,
      'utf-8',
    );

    const runner = await createRunnerForPipeline(tmpYaml);
    const result = await runner.profile(tmpYaml, { outputDir: workDir });

    expect(result.profilePath).toBeTruthy();
    expect(existsSync(result.profilePath!)).toBe(true);
    expect(result.extract.tableName).toBe('stg_merged');
    expect(result.load).toBeNull();
    expect(result.transform).toBeNull();
  });

  it('single-source selection still returns PipelineRunner', async () => {
    const outputCsv = join(workDir, 'out.csv');
    const yamlPath = writeMinimal(workDir, outputCsv);

    const runner = await createRunnerForPipeline(yamlPath);
    expect(runner).toBeInstanceOf(PipelineRunner);
  });

  it('single-source PipelineRunner still rejects multi-source profile directly', async () => {
    const raw = await import('node:fs').then(fs =>
      fs.readFileSync(multiSourceFixture, 'utf-8')
        .replace(/\$\{[^}]+\}/g, 'placeholder'),
    );
    const tmpYaml = path.join(tmpdir(), 'style-co-products-merged-profile-test.pipeline.yaml');
    writeFileSync(tmpYaml, raw, 'utf-8');

    await expect(new PipelineRunner().profile(tmpYaml)).rejects.toBeInstanceOf(ConfigError);
  });

  it('multi-source runner path can execute a simple csv+csv merged pipeline', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sluice-cli-ms-'));
    const a = join(workDir, 'a.csv');
    const b = join(workDir, 'b.csv');
    const out = join(workDir, 'out.csv');

    writeFileSync(a, 'ID,VAL,NAME\nA,1,\nB,2,FromA\n', 'utf-8');
    writeFileSync(b, 'ID,VAL,NAME\nA,9,FromB\nC,3,FromC\n', 'utf-8');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline: { name: cli-ms-run, client: t, version: "1.0", entity: T }
sources:
  - { id: one, priority: 1, adapter: csv, file: ${yp(a)} }
  - { id: two, priority: 2, adapter: csv, file: ${yp(b)} }
merge: { key: ID, strategy: coalesce, onUnmatched: include }
dq: { stopOnCritical: true, rules: [] }
transform:
  fields:
    - { from: ID, to: Id, type: string }
    - { from: VAL, to: Val, type: string }
    - { from: NAME, to: Name, type: string, optional: true }
target: { adapter: csv, output: ${yp(out)}, includeHeader: true }
run: { stagingDb: ":memory:", outputDir: ${yp(workDir)} }
`,
      'utf-8',
    );

    const runner = await createRunnerForPipeline(yaml);
    const result = await runner.run(yaml);

    expect(result.pipeline).toBe('cli-ms-run');
    expect(result.extract.tableName).toBe('stg_merged');
    expect(result.load?.rowsLoaded).toBe(3);
    expect(existsSync(out)).toBe(true);
  });
});
