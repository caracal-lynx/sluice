import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SourceAdapterRegistry } from '../../src/adapters/source/index.js';
import { TargetAdapterRegistry } from '../../src/adapters/target/index.js';
import { ConfigLoader } from '../../src/config/loader.js';
import type { Pipeline } from '../../src/config/types.js';
import type { DQSummary } from '../../src/dq/index.js';
import { PipelineRunner } from '../../src/runner.js';
import { StagingStore, type ColumnMeta } from '../../src/staging/index.js';
import type { TransformResult } from '../../src/transform/index.js';
import { ConfigError, PipelineDQError } from '../../src/utils/errors.js';

function makePipeline(workDir: string, overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    pipeline: {
      name: 'runner-test',
      client: 'test',
      version: '1.0',
      entity: 'Test',
    },
    source: { adapter: 'csv', file: './input.csv', delimiter: ',', encoding: 'utf-8' },
    dq: { stopOnCritical: false, rules: [] },
    transform: {
      lookups: [],
      fields: [{ from: 'id', to: 'Id', type: 'string', optional: false }],
    },
    target: {
      adapter: 'csv',
      output: join(workDir, 'output.csv'),
      delimiter: ',',
      encoding: 'utf-8',
      nullValue: '',
      includeHeader: true,
      apiVersion: 'v2.0',
      onConflict: 'fail',
      batchEndpoint: true,
      schema: 'public',
    },
    run: {
      mode: 'full',
      batchSize: 500,
      onError: 'continue',
      logLevel: 'info',
      dryRun: false,
      outputDir: workDir,
      stagingDb: ':memory:',
    },
    ...overrides,
  } as Pipeline;
}

function makeSummary(overrides: Partial<DQSummary> = {}): DQSummary {
  return {
    pipeline: 'runner-test',
    runAt: '2026-04-19T00:00:00.000Z',
    rowsChecked: 1,
    rowsPassed: 1,
    rowsRejected: 0,
    violations: { critical: 0, warning: 0, info: 0 },
    byField: {},
    reportPath: 'summary.json',
    ...overrides,
  };
}

function makeMultiSourcePipeline(workDir: string): Pipeline {
  return {
    pipeline: {
      name: 'multi-runner-test',
      client: 'test',
      version: '1.0',
      entity: 'Test',
    },
    sources: [
      { id: 'primary',   priority: 1, adapter: 'csv', file: './a.csv', delimiter: ',', encoding: 'utf-8' },
      { id: 'secondary', priority: 2, adapter: 'csv', file: './b.csv', delimiter: ',', encoding: 'utf-8' },
    ],
    merge: { key: 'ID', strategy: 'coalesce', onUnmatched: 'include', fieldStrategies: [] },
    dq: { stopOnCritical: false, rules: [] },
    transform: {
      lookups: [],
      fields: [{ from: 'id', to: 'Id', type: 'string', optional: false }],
    },
    target: {
      adapter: 'csv',
      output: join(workDir, 'output.csv'),
      delimiter: ',',
      encoding: 'utf-8',
      nullValue: '',
      includeHeader: true,
      apiVersion: 'v2.0',
      onConflict: 'fail',
      batchEndpoint: true,
      schema: 'public',
    },
    run: {
      mode: 'full',
      batchSize: 500,
      onError: 'continue',
      logLevel: 'info',
      dryRun: false,
      outputDir: workDir,
      stagingDb: ':memory:',
    },
  } as Pipeline;
}

class TestableRunner extends PipelineRunner {
  callRunExtract(config: Pipeline, store: StagingStore, tableName = 'stg_raw') {
    return this.runExtract(config, store, tableName);
  }

  callRunDQ(config: Pipeline, store: StagingStore, tableName = 'stg_raw') {
    return this.runDQ(config, store, tableName);
  }

  callRunTransform(
    config: Pipeline,
    store: StagingStore,
    sourceTable = 'stg_raw',
    targetTable = 'stg_transformed',
  ) {
    return this.runTransform(config, store, sourceTable, targetTable);
  }

  callRunLoad(config: Pipeline, store: StagingStore) {
    return this.runLoad(config, store);
  }

  callWriteStateFile(
    config: Pipeline,
    extract: { rowsExtracted: number; tableName: string; columns: ColumnMeta[] },
    dq: DQSummary,
    load: { rowsLoaded: number; rowsFailed: number; outputPath?: string },
  ) {
    return this.writeStateFile(config, extract, dq, load);
  }
}

class RecordingRunner extends PipelineRunner {
  readonly calls: string[] = [];
  dqSummary: DQSummary = makeSummary();

  protected override async runExtract(): Promise<{
    rowsExtracted: number;
    tableName: string;
    columns: ColumnMeta[];
  }> {
    this.calls.push('extract');
    return {
      rowsExtracted: 2,
      tableName: 'stg_raw',
      columns: [{ name: 'id', duckDbType: 'VARCHAR' }],
    };
  }

  protected override async runDQ(): Promise<DQSummary> {
    this.calls.push('dq');
    return this.dqSummary;
  }

  protected override async runTransform(): Promise<TransformResult> {
    this.calls.push('transform');
    return { rowsIn: 2, rowsOut: 2, rowsFailed: 0 };
  }

  protected override async runLoad(): Promise<{
    rowsLoaded: number;
    rowsFailed: number;
    outputPath?: string;
  }> {
    this.calls.push('load');
    return { rowsLoaded: 2, rowsFailed: 0, outputPath: 'output.csv' };
  }

  protected override async writeStateFile(): Promise<string> {
    this.calls.push('state');
    return 'state.json';
  }
}

describe('PipelineRunner protected phase methods', () => {
  let workDir: string;
  let store: StagingStore;

  beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'sluice-runner-'));
    store = new StagingStore(':memory:');
    await store.open();
  });

  afterEach(async () => {
    await store.close();
    rmSync(workDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runExtract delegates to the source adapter with the provided table name', async () => {
    const runner = new TestableRunner();
    const config = makePipeline(workDir);
    const extract = vi.fn().mockResolvedValue({
      rowsExtracted: 1,
      tableName: 'stg_custom',
      columns: [{ name: 'id', duckDbType: 'VARCHAR' }],
    });
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(SourceAdapterRegistry, 'get').mockReturnValue({
      id: 'csv',
      connect,
      extract,
      disconnect,
    });

    const result = await runner.callRunExtract(config, store, 'stg_custom');

    expect(connect).toHaveBeenCalledWith(config.source);
    expect(extract).toHaveBeenCalledWith(
      config.source,
      store,
      config.run,
      expect.any(Function),
      'stg_custom',
    );
    expect(disconnect).toHaveBeenCalled();
    expect(result.tableName).toBe('stg_custom');
  });

  it('runExtract drops the staging table before extracting (regression: persistent DB appending)', async () => {
    // buildCreateTableSql emits `CREATE TABLE IF NOT EXISTS`. If runExtract
    // did not drop the table first, a re-run against a persistent staging
    // DuckDB file would keep the prior rows and the adapter would insert
    // another batch on top, inflating DQ/transform/load row counts.
    const runner = new TestableRunner();
    const config = makePipeline(workDir);
    const calls: string[] = [];

    const dropSpy = vi.spyOn(store, 'dropTable').mockImplementation(async () => {
      calls.push('dropTable');
    });
    const extract = vi.fn().mockImplementation(async () => {
      calls.push('extract');
      return {
        rowsExtracted: 0,
        tableName: 'stg_raw',
        columns: [{ name: 'id', duckDbType: 'VARCHAR' }],
      };
    });

    vi.spyOn(SourceAdapterRegistry, 'get').mockReturnValue({
      id: 'csv',
      connect: vi.fn().mockResolvedValue(undefined),
      extract,
      disconnect: vi.fn().mockResolvedValue(undefined),
    });

    await runner.callRunExtract(config, store, 'stg_raw');

    expect(dropSpy).toHaveBeenCalledWith('stg_raw');
    // The drop must come before the extract so the table is empty when the
    // adapter's insertBatch calls start firing.
    expect(calls).toEqual(['dropTable', 'extract']);
  });

  it('runDQ delegates to the DQ engine with the provided table name', async () => {
    const runner = new TestableRunner();
    const config = makePipeline(workDir);
    const summary = makeSummary();
    const dqSpy = vi.spyOn((runner as unknown as { dqEngine: { run: () => Promise<DQSummary> } }).dqEngine, 'run')
      .mockResolvedValue(summary);

    const result = await runner.callRunDQ(config, store, 'stg_merged');

    expect(dqSpy).toHaveBeenCalledWith(config, store, 'stg_merged', expect.any(Function));
    expect(result).toBe(summary);
  });

  it('runTransform delegates to the transform engine with custom table names', async () => {
    const runner = new TestableRunner();
    const config = makePipeline(workDir);
    const transformResult: TransformResult = { rowsIn: 2, rowsOut: 1, rowsFailed: 1 };
    const transformSpy = vi.spyOn(
      (runner as unknown as { transformEngine: { run: () => Promise<TransformResult> } }).transformEngine,
      'run',
    ).mockResolvedValue(transformResult);

    const result = await runner.callRunTransform(config, store, 'stg_merged', 'stg_final');

    expect(transformSpy).toHaveBeenCalledWith(config, store, 'stg_merged', 'stg_final', expect.any(Function));
    expect(result).toBe(transformResult);
  });

  it('runLoad delegates to the target adapter and disconnects afterwards', async () => {
    const runner = new TestableRunner();
    const config = makePipeline(workDir);
    const load = vi.fn().mockResolvedValue({ rowsLoaded: 2, rowsFailed: 0, outputPath: 'out.csv' });
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(TargetAdapterRegistry, 'get').mockReturnValue({
      id: 'csv',
      connect,
      load,
      disconnect,
    });

    const result = await runner.callRunLoad(config, store);

    expect(connect).toHaveBeenCalledWith(config.target);
    expect(load).toHaveBeenCalledWith(config.target, store, config.run, expect.any(Function));
    expect(disconnect).toHaveBeenCalled();
    expect(result.rowsLoaded).toBe(2);
  });

  it('writeStateFile writes the expected state JSON', async () => {
    const runner = new TestableRunner();
    const config = makePipeline(workDir, {
      run: { ...makePipeline(workDir).run, stagingDb: '', outputDir: workDir },
    });

    const statePath = await runner.callWriteStateFile(
      config,
      { rowsExtracted: 3, tableName: 'stg_raw', columns: [] },
      makeSummary({ violations: { critical: 1, warning: 2, info: 0 } }),
      { rowsLoaded: 2, rowsFailed: 1, outputPath: join(workDir, 'out.csv') },
    );

    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    expect(state['pipeline']).toBe('runner-test');
    expect(state['lastMode']).toBe('full');
    expect(state['rowsExtracted']).toBe(3);
    expect(state['rowsLoaded']).toBe(2);
    expect(state['criticalViolations']).toBe(1);
    expect(state['warnings']).toBe(2);
  });
});

describe('PipelineRunner.run() orchestration', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sluice-runner-order-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('calls phase methods in the expected order for a full run', async () => {
    const runner = new RecordingRunner();
    vi.spyOn(ConfigLoader, 'load').mockResolvedValue(makePipeline(workDir));

    const result = await runner.run('pipeline.yaml');

    expect(runner.calls).toEqual(['extract', 'dq', 'transform', 'load', 'state']);
    expect(result.stateFilePath).toBe('state.json');
  });

  it('stops after transform for dryRun', async () => {
    const runner = new RecordingRunner();
    vi.spyOn(ConfigLoader, 'load').mockResolvedValue(makePipeline(workDir, {
      run: { ...makePipeline(workDir).run, dryRun: true },
    }));

    const result = await runner.run('pipeline.yaml');

    expect(runner.calls).toEqual(['extract', 'dq', 'transform']);
    expect(result.load).toBeNull();
    expect(result.transform).toEqual({ rowsIn: 2, rowsOut: 2, rowsFailed: 0 });
  });

  it('stops after transform for validate-only mode', async () => {
    const runner = new RecordingRunner();
    vi.spyOn(ConfigLoader, 'load').mockResolvedValue(makePipeline(workDir, {
      run: { ...makePipeline(workDir).run, mode: 'validate-only' },
    }));

    const result = await runner.run('pipeline.yaml');

    expect(runner.calls).toEqual(['extract', 'dq', 'transform']);
    expect(result.mode).toBe('validate-only');
    expect(result.load).toBeNull();
  });

  it('halts after DQ when critical violations are configured to stop the pipeline', async () => {
    const runner = new RecordingRunner();
    runner.dqSummary = makeSummary({
      rowsRejected: 1,
      violations: { critical: 1, warning: 0, info: 0 },
      rejectedRowIndices: [0],
    });
    vi.spyOn(ConfigLoader, 'load').mockResolvedValue(makePipeline(workDir, {
      dq: { stopOnCritical: true, rules: [] },
    }));

    await expect(runner.run('pipeline.yaml')).rejects.toBeInstanceOf(PipelineDQError);
    expect(runner.calls).toEqual(['extract', 'dq']);
  });

  it('throws ConfigError immediately when run() receives a multi-source pipeline', async () => {
    const runner = new RecordingRunner();
    vi.spyOn(ConfigLoader, 'load').mockResolvedValue(makeMultiSourcePipeline(workDir));

    await expect(runner.run('pipeline.yaml')).rejects.toBeInstanceOf(ConfigError);
    // No phase methods should have been called — the guard fires before any I/O
    expect(runner.calls).toHaveLength(0);
  });

  it('passes pluginDirs overrides to loadAllPlugins', async () => {
    const runner = new RecordingRunner();
    vi.spyOn(ConfigLoader, 'load').mockResolvedValue(makePipeline(workDir));
    const loadPluginsSpy = vi
      .spyOn(runner as unknown as { loadAllPlugins: (cwd: string, pluginDirs?: string[]) => Promise<void> }, 'loadAllPlugins')
      .mockResolvedValue(undefined);

    await runner.run('pipeline.yaml', { pluginDirs: ['./extra-plugins'] });

    expect(loadPluginsSpy).toHaveBeenCalledWith(
      expect.any(String),
      ['./extra-plugins'],
    );
  });
});
