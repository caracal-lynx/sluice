/**
 * Phase 4a — runner enrich-hook wiring integration tests.
 *
 * Verifies the open-source side of Phase 4a: the `registerEnrichPhase()`
 * injection hook, the `runEnrich` slot in `PipelineRunner` and
 * `MultiSourcePipelineRunner`, and the four self-skip rules
 * (no enrich block / --no-enrich / validate-only / no factory registered).
 *
 * Uses a no-op stub factory — no real DuckDB column writes happen.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MultiSourcePipelineRunner } from '../../src/multi-source-runner.js';
import {
  PipelineRunner,
  _resetEnrichPhaseForTesting,
  registerEnrichPhase,
  type RunResult,
} from '../../src/runner.js';
import type {
  EnrichConfig,
  EnrichPhaseFactory,
  EnrichSummary,
  LookupSummary,
} from '../../src/enrich/types.js';
import type { RunConfig } from '../../src/config/schema.js';
import type { StagingStore } from '../../src/staging/store.js';
import type { Logger } from 'pino';

// Use the OS temp dir, NOT a `.tmp` folder inside the repo. Other test files
// use `.tmp` and recursively rm it in afterEach — that race-condition wipes
// our working files when tests run concurrently across files.
const tmpRoot = path.join(os.tmpdir(), 'sluice-enrich-hook');

interface FactoryCall {
  config: EnrichConfig;
  runConfig: RunConfig;
  staging: StagingStore;
  pluginDir: string;
  logger: Logger;
  sourceTable: string;
}

interface StubFactoryHandle {
  factory: EnrichPhaseFactory;
  calls: FactoryCall[];
  summary: EnrichSummary;
}

function makeStubFactory(opts?: { throwInside?: boolean }): StubFactoryHandle {
  const calls: FactoryCall[] = [];
  const lookupStub: LookupSummary = {
    provider: 'mock',
    field: 'X',
    totalRows: 0,
    validCount: 0,
    errorCount: 0,
    skipCount: 0,
    cacheHits: 0,
    consultationRefs: {},
  };
  const summary: EnrichSummary = { lookups: [lookupStub] };

  const factory: EnrichPhaseFactory = (
    config,
    runConfig,
    staging,
    pluginDir,
    logger,
    sourceTable,
  ) => {
    calls.push({ config, runConfig, staging, pluginDir, logger, sourceTable });
    return {
      async run() {
        if (opts?.throwInside) {
          throw new Error('stub factory: should not have been called');
        }
        return summary;
      },
    };
  };
  return { factory, calls, summary };
}

async function makeUniqueTmpDir(prefix: string): Promise<string> {
  const dir = path.join(tmpRoot, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeSingleSourcePipeline(
  tmpDir: string,
  withEnrich: boolean,
  extras: { mode?: 'full' | 'validate-only'; dryRun?: boolean } = {},
): Promise<string> {
  const inputCsv = path.join(tmpDir, 'input.csv');
  const outputCsv = path.join(tmpDir, 'output.csv');
  await fs.writeFile(inputCsv, 'id\n1\n2\n3', 'utf-8');

  const yamlPath = path.join(tmpDir, 'test.pipeline.yaml');
  const enrichBlock = withEnrich
    ? `
enrich:
  lookups:
    - field: id
      provider: mock
      writeColumns:
        valid: id_valid
`
    : '';
  const mode = extras.mode ?? 'full';
  const dryRun = extras.dryRun ?? false;
  const yaml = `
pipeline:
  name: enrich-hook-test
  client: test
  version: "1.0"
  entity: Test

source:
  adapter: csv
  file: ${inputCsv.replace(/\\/g, '/')}
${enrichBlock}
dq:
  stopOnCritical: false
  rules: []

transform:
  fields:
    - from: id
      to: id
      type: string

target:
  adapter: csv
  output: ${outputCsv.replace(/\\/g, '/')}

run:
  outputDir: ${tmpDir.replace(/\\/g, '/')}
  mode: ${mode}
  dryRun: ${dryRun}
`;
  await fs.writeFile(yamlPath, yaml, 'utf-8');
  return yamlPath;
}

async function writeMultiSourcePipeline(tmpDir: string, withEnrich: boolean): Promise<string> {
  const inputA = path.join(tmpDir, 'a.csv');
  const inputB = path.join(tmpDir, 'b.csv');
  const outputCsv = path.join(tmpDir, 'output.csv');
  await fs.writeFile(inputA, 'id,name\n1,Alice\n2,Bob', 'utf-8');
  await fs.writeFile(inputB, 'id,name\n2,Bobby\n3,Carol', 'utf-8');

  const yamlPath = path.join(tmpDir, 'multi.pipeline.yaml');
  const enrichBlock = withEnrich
    ? `
enrich:
  lookups:
    - field: id
      provider: mock
      writeColumns:
        valid: id_valid
`
    : '';
  const yaml = `
pipeline:
  name: enrich-hook-multi-test
  client: test
  version: "1.0"
  entity: Test

sources:
  - id: src-a
    priority: 1
    adapter: csv
    file: ${inputA.replace(/\\/g, '/')}
  - id: src-b
    priority: 2
    adapter: csv
    file: ${inputB.replace(/\\/g, '/')}

merge:
  key: id
  strategy: coalesce
${enrichBlock}
dq:
  stopOnCritical: false
  rules: []

transform:
  fields:
    - from: id
      to: id
      type: string

target:
  adapter: csv
  output: ${outputCsv.replace(/\\/g, '/')}

run:
  outputDir: ${tmpDir.replace(/\\/g, '/')}
`;
  await fs.writeFile(yamlPath, yaml, 'utf-8');
  return yamlPath;
}

async function readStateFile(outputDir: string, pipelineName: string): Promise<Record<string, unknown>> {
  const stateFilePath = path.join(outputDir, `${pipelineName}-state.json`);
  const raw = await fs.readFile(stateFilePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────────────────

describe('PipelineRunner — Phase 4a enrich hook (single source)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    await fs.mkdir(tmpRoot, { recursive: true });
    tmpDir = await makeUniqueTmpDir('enrich-single');
  });

  afterEach(async () => {
    _resetEnrichPhaseForTesting();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('skips the phase silently when no enrich: block is configured', async () => {
    const yamlPath = await writeSingleSourcePipeline(tmpDir, /* withEnrich */ false);
    const handle = makeStubFactory({ throwInside: true });
    registerEnrichPhase(handle.factory);

    const runner = new PipelineRunner();
    const result: RunResult = await runner.run(yamlPath);

    expect(handle.calls).toHaveLength(0);
    expect(result.enrichSummary).toBeUndefined();
  });

  it('skips the phase with a WARN when enrich: is configured but no factory is registered', async () => {
    _resetEnrichPhaseForTesting();
    const yamlPath = await writeSingleSourcePipeline(tmpDir, /* withEnrich */ true);

    const runner = new PipelineRunner();
    const result = await runner.run(yamlPath);

    expect(result.enrichSummary).toBeUndefined();
    // pipeline still completes; load happened
    expect(result.load?.rowsLoaded).toBe(3);
    // state file written without an enrichSummary key
    const state = await readStateFile(tmpDir, 'enrich-hook-test');
    expect(state['enrichSummary']).toBeUndefined();
  });

  it('invokes the registered factory exactly once with the expected args', async () => {
    const yamlPath = await writeSingleSourcePipeline(tmpDir, /* withEnrich */ true);
    const handle = makeStubFactory();
    registerEnrichPhase(handle.factory);

    const runner = new PipelineRunner();
    const result = await runner.run(yamlPath);

    expect(handle.calls).toHaveLength(1);
    const call = handle.calls[0]!;
    expect(call.config.lookups[0]?.field).toBe('id');
    expect(call.pluginDir).toBe(path.dirname(path.resolve(yamlPath)));
    expect(call.runConfig.enrichTimeoutMs).toBe(5000);
    expect(call.staging).toBeDefined();
    expect(call.sourceTable).toBe('stg_raw');
    expect(result.enrichSummary).toEqual(handle.summary);

    const state = await readStateFile(tmpDir, 'enrich-hook-test');
    expect(state['enrichSummary']).toEqual(handle.summary);
  });

  it('--no-enrich (overrides.skipEnrich=true) bypasses the factory', async () => {
    const yamlPath = await writeSingleSourcePipeline(tmpDir, /* withEnrich */ true);
    const handle = makeStubFactory({ throwInside: true });
    registerEnrichPhase(handle.factory);

    const runner = new PipelineRunner();
    const result = await runner.run(yamlPath, { skipEnrich: true });

    expect(handle.calls).toHaveLength(0);
    expect(result.enrichSummary).toBeUndefined();
  });

  it('validate-only mode bypasses the factory even when registered', async () => {
    const yamlPath = await writeSingleSourcePipeline(tmpDir, /* withEnrich */ true, {
      mode: 'validate-only',
    });
    const handle = makeStubFactory({ throwInside: true });
    registerEnrichPhase(handle.factory);

    const runner = new PipelineRunner();
    const result = await runner.run(yamlPath);

    expect(handle.calls).toHaveLength(0);
    expect(result.enrichSummary).toBeUndefined();
  });

  it('dryRun bypasses the factory even when registered', async () => {
    const yamlPath = await writeSingleSourcePipeline(tmpDir, /* withEnrich */ true, {
      dryRun: true,
    });
    const handle = makeStubFactory({ throwInside: true });
    registerEnrichPhase(handle.factory);

    const runner = new PipelineRunner();
    const result = await runner.run(yamlPath);

    expect(handle.calls).toHaveLength(0);
    expect(result.enrichSummary).toBeUndefined();
  });
});

describe('MultiSourcePipelineRunner — Phase 4a enrich hook (post-merge)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    await fs.mkdir(tmpRoot, { recursive: true });
    tmpDir = await makeUniqueTmpDir('enrich-multi');
  });

  afterEach(async () => {
    _resetEnrichPhaseForTesting();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('invokes the factory exactly once after merge, before post-merge DQ', async () => {
    const yamlPath = await writeMultiSourcePipeline(tmpDir, /* withEnrich */ true);
    const handle = makeStubFactory();
    registerEnrichPhase(handle.factory);

    const runner = new MultiSourcePipelineRunner();
    const result = await runner.run(yamlPath);

    expect(handle.calls).toHaveLength(1);
    const call = handle.calls[0]!;
    expect(call.sourceTable).toBe('stg_merged');
    expect(result.enrichSummary).toEqual(handle.summary);

    const state = await readStateFile(tmpDir, 'enrich-hook-multi-test');
    expect(state['enrichSummary']).toEqual(handle.summary);
    expect(state['sources']).toBeDefined(); // merge state still preserved
  });

  it('skips the factory when no enrich block is configured', async () => {
    const yamlPath = await writeMultiSourcePipeline(tmpDir, /* withEnrich */ false);
    const handle = makeStubFactory({ throwInside: true });
    registerEnrichPhase(handle.factory);

    const runner = new MultiSourcePipelineRunner();
    const result = await runner.run(yamlPath);

    expect(handle.calls).toHaveLength(0);
    expect(result.enrichSummary).toBeUndefined();
  });

  it('--no-enrich bypasses the factory', async () => {
    const yamlPath = await writeMultiSourcePipeline(tmpDir, /* withEnrich */ true);
    const handle = makeStubFactory({ throwInside: true });
    registerEnrichPhase(handle.factory);

    const runner = new MultiSourcePipelineRunner();
    const result = await runner.run(yamlPath, { skipEnrich: true });

    expect(handle.calls).toHaveLength(0);
    expect(result.enrichSummary).toBeUndefined();
  });
});
