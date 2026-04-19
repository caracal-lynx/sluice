/**
 * PipelineRunner — the single entry point for a Sluice pipeline.
 *
 * Phase 3 prep Change 5 baked in:
 *   - Public `run()` is the only public method; behaviour unchanged for single-source.
 *   - Work decomposed into `protected` phase methods so Phase 3's
 *     MultiSourcePipelineRunner can override each phase cleanly.
 *   - `runDQ` carries an unused `sourceId?: string` parameter reserved for Phase 3.
 *   - `writeStateFile` is protected so the multi-source runner can override it.
 *
 * Phase 4 MVP: `runDQ`, `runTransform`, and `writeStateFile` are minimal stubs.
 *   - DQ: zero-violation summary (real engine lands in Phase 5).
 *   - Transform: CREATE OR REPLACE TABLE stg_transformed AS SELECT * FROM stg_raw.
 *   - writeStateFile: log-only (real implementation lands in Phase 9).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ColumnMeta } from './staging/index.js';

// The adapter barrels have a side effect that self-registers built-in adapters
// on first evaluation. Importing from them is sufficient — no extra "for side
// effect" import required.
import { SourceAdapterRegistry, type ExtractResult } from './adapters/source/index.js';
import { TargetAdapterRegistry, type LoadResult } from './adapters/target/index.js';
import { ConfigLoader } from './config/loader.js';
import type { Pipeline } from './config/types.js';
import { DQEngine, type DQSummary } from './dq/index.js';
import { StagingStore } from './staging/index.js';
import { TransformEngine, type TransformResult } from './transform/index.js';
import { ConfigError, PipelineDQError } from './utils/errors.js';
import { logger } from './utils/logger.js';

export interface RunResult {
  pipeline: string;
  mode: Pipeline['run']['mode'];
  extract: ExtractResult;
  dq: DQSummary;
  transform: TransformResult | null;
  load: LoadResult | null;
  /** Path to the state JSON written at the end of a successful run. */
  stateFilePath?: string;
  /** Set by `sluice profile`; absent for other commands. */
  profilePath?: string;
}

/** CLI-level overrides applied to the loaded Pipeline config. */
export interface RunOverrides {
  outputDir?: string;
  dryRun?: boolean;
  mode?: Pipeline['run']['mode'];
}

export class PipelineRunner {
  protected readonly dqEngine: DQEngine = new DQEngine();
  protected readonly transformEngine: TransformEngine = new TransformEngine();

  async run(yamlPath: string, overrides: RunOverrides = {}): Promise<RunResult> {
    const loaded = await ConfigLoader.load(yamlPath);
    const config = this.applyOverrides(loaded, overrides);
    logger.info(
      { pipeline: config.pipeline.name, yaml: yamlPath, mode: config.run.mode },
      'pipeline: start',
    );

    if (config.run.mode === 'incremental') {
      throw new ConfigError('incremental mode is not yet implemented (Phase 1 limitation)');
    }

    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const store = new StagingStore(this.resolveStagingDb(config));
    try {
      await store.open();

      const extractResult = await this.runExtract(config, store, 'stg_raw');
      const dqSummary = await this.runDQ(config, store, extractResult.tableName);

      if (config.dq.stopOnCritical && dqSummary.violations.critical > 0) {
        throw new PipelineDQError(dqSummary.violations.critical, dqSummary.reportPath);
      }

      if (config.run.dryRun || config.run.mode === 'validate-only') {
        logger.info(
          { dryRun: config.run.dryRun, mode: config.run.mode },
          'pipeline: stopping before load',
        );
        return this.buildRunResult(config, extractResult, dqSummary, null, null);
      }

      const transformResult = await this.runTransform(
        config,
        store,
        extractResult.tableName,
        'stg_transformed',
      );
      const loadResult = await this.runLoad(config, store);
      const stateFilePath = await this.writeStateFile(config, extractResult, dqSummary, loadResult);

      logger.info(
        {
          pipeline: config.pipeline.name,
          rowsExtracted: extractResult.rowsExtracted,
          rowsLoaded: loadResult.rowsLoaded,
        },
        'pipeline: done',
      );

      return {
        ...this.buildRunResult(config, extractResult, dqSummary, transformResult, loadResult),
        stateFilePath,
      };
    } finally {
      await store.close();
    }
  }

  // ── Protected phase methods (overrideable by MultiSourcePipelineRunner) ─

  protected async runExtract(
    config: Pipeline,
    store: StagingStore,
    tableName = 'stg_raw',
  ): Promise<ExtractResult> {
    const adapter = SourceAdapterRegistry.get(config.source.adapter);
    await adapter.connect(config.source);
    try {
      const result = await adapter.extract(
        config.source,
        store,
        config.run,
        (rows) => logger.debug({ rows }, 'extracting'),
        tableName,
      );
      logger.info(
        { rowsExtracted: result.rowsExtracted, table: result.tableName },
        'pipeline: extract complete',
      );
      return result;
    } finally {
      await adapter.disconnect();
    }
  }

  protected async runDQ(
    config: Pipeline,
    store: StagingStore,
    tableName = 'stg_raw',
    _sourceId?: string, // Phase 3 prep Change 5 — filtering lands with multi-source.
  ): Promise<DQSummary> {
    const summary = await this.dqEngine.run(config, store, tableName);
    logger.info(
      {
        rowsChecked: summary.rowsChecked,
        rowsRejected: summary.rowsRejected,
        critical: summary.violations.critical,
        warning: summary.violations.warning,
        info: summary.violations.info,
      },
      'pipeline: dq complete',
    );
    return summary;
  }

  protected async runTransform(
    config: Pipeline,
    store: StagingStore,
    sourceTable = 'stg_raw',
    targetTable = 'stg_transformed',
  ): Promise<TransformResult> {
    const result = await this.transformEngine.run(config, store, sourceTable, targetTable);
    logger.info(
      {
        rowsIn: result.rowsIn,
        rowsOut: result.rowsOut,
        rowsFailed: result.rowsFailed,
        sourceTable,
        targetTable,
      },
      'pipeline: transform complete',
    );
    return result;
  }

  protected async runLoad(config: Pipeline, store: StagingStore): Promise<LoadResult> {
    const adapter = TargetAdapterRegistry.get(config.target.adapter);
    await adapter.connect(config.target);
    try {
      const result = await adapter.load(
        config.target,
        store,
        config.run,
        (rows) => logger.debug({ rows }, 'loading'),
      );
      logger.info(
        { rowsLoaded: result.rowsLoaded, outputPath: result.outputPath },
        'pipeline: load complete',
      );
      return result;
    } finally {
      await adapter.disconnect();
    }
  }

  protected async writeStateFile(
    config: Pipeline,
    extract: ExtractResult,
    dq: DQSummary,
    load: LoadResult,
  ): Promise<string> {
    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    const stateFilePath = path.join(outputDir, `${config.pipeline.name}-state.json`);
    const state = {
      pipeline: config.pipeline.name,
      lastRunAt: new Date().toISOString(),
      lastMode: config.run.mode,
      rowsExtracted: extract.rowsExtracted,
      rowsLoaded: load.rowsLoaded,
      criticalViolations: dq.violations.critical,
      warnings: dq.violations.warning,
      incrementalSince: config.run.incrementalSince ?? '',
    };
    await fs.writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    logger.debug({ stateFilePath }, 'pipeline: state file written');
    return stateFilePath;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * `sluice profile` entry point — extract only, then emit per-column stats.
   * Never writes an output CSV, never runs DQ or transforms.
   */
  async profile(yamlPath: string, overrides: RunOverrides = {}): Promise<RunResult> {
    const loaded = await ConfigLoader.load(yamlPath);
    const config = this.applyOverrides(loaded, overrides);
    if (config.run.mode === 'incremental') {
      throw new ConfigError('incremental mode is not yet implemented (Phase 1 limitation)');
    }
    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const store = new StagingStore(this.resolveStagingDb(config));
    try {
      await store.open();
      const extractResult = await this.runExtract(config, store, 'stg_raw');
      const profile = await this.buildProfile(store, extractResult.tableName, extractResult.columns);
      const profilePath = path.join(outputDir, `${config.pipeline.name}-profile.json`);
      await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8');
      logger.info({ profilePath, columns: profile.length }, 'pipeline: profile complete');

      return {
        pipeline: config.pipeline.name,
        mode: config.run.mode,
        extract: extractResult,
        dq: stubDqSummary(config.pipeline.name, extractResult.rowsExtracted),
        transform: null,
        load: null,
        profilePath,
      };
    } finally {
      await store.close();
    }
  }

  private async buildProfile(
    store: StagingStore,
    tableName: string,
    columns: ColumnMeta[],
  ): Promise<ProfileColumn[]> {
    const result: ProfileColumn[] = [];
    const tbl = tableName;
    const rowCountRow = await store.query<{ n: unknown }>(
      `SELECT count(*) AS n FROM "${tbl}"`,
    );
    const rowCount = Number(rowCountRow[0]?.n ?? 0);
    for (const col of columns) {
      const qCol = `"${col.name.replace(/"/g, '""')}"`;
      const [nullCountRow] = await store.query<{ n: unknown }>(
        `SELECT count(*) AS n FROM "${tbl}" WHERE ${qCol} IS NULL`,
      );
      const [distinctRow] = await store.query<{ n: unknown }>(
        `SELECT count(DISTINCT ${qCol}) AS n FROM "${tbl}"`,
      );
      const lenRow = await store.query<{ mn: unknown; mx: unknown }>(
        `SELECT min(length(CAST(${qCol} AS VARCHAR))) AS mn, max(length(CAST(${qCol} AS VARCHAR))) AS mx FROM "${tbl}"`,
      );
      const sampleRows = await store.query<Record<string, unknown>>(
        `SELECT DISTINCT ${qCol} AS v FROM "${tbl}" WHERE ${qCol} IS NOT NULL LIMIT 5`,
      );
      result.push({
        name: col.name,
        duckDbType: col.duckDbType,
        rowCount,
        nullCount: Number(nullCountRow?.n ?? 0),
        distinctCount: Number(distinctRow?.n ?? 0),
        minLen: lenRow[0]?.mn === null || lenRow[0]?.mn === undefined ? null : Number(lenRow[0].mn),
        maxLen: lenRow[0]?.mx === null || lenRow[0]?.mx === undefined ? null : Number(lenRow[0].mx),
        sample: sampleRows.map((r) => (r['v'] === null || r['v'] === undefined ? null : String(r['v']))),
      });
    }
    return result;
  }

  private applyOverrides(config: Pipeline, overrides: RunOverrides): Pipeline {
    if (Object.keys(overrides).length === 0) return config;
    const run = { ...config.run };
    if (overrides.outputDir !== undefined) run.outputDir = overrides.outputDir;
    if (overrides.dryRun !== undefined) run.dryRun = overrides.dryRun;
    if (overrides.mode !== undefined) run.mode = overrides.mode;
    return { ...config, run };
  }

  private resolveStagingDb(config: Pipeline): string {
    if (config.run.stagingDb) return config.run.stagingDb;
    if (config.run.dryRun) return ':memory:';
    return path.join(
      path.resolve(config.run.outputDir),
      `${config.pipeline.name}.duckdb`,
    );
  }

  private buildRunResult(
    config: Pipeline,
    extract: ExtractResult,
    dq: DQSummary,
    transform: TransformResult | null,
    load: LoadResult | null,
  ): RunResult {
    return {
      pipeline: config.pipeline.name,
      mode: config.run.mode,
      extract,
      dq,
      transform,
      load,
    };
  }
}

interface ProfileColumn {
  name: string;
  duckDbType: string;
  rowCount: number;
  nullCount: number;
  distinctCount: number;
  minLen: number | null;
  maxLen: number | null;
  sample: (string | null)[];
}

function stubDqSummary(pipelineName: string, rowsChecked: number): DQSummary {
  return {
    pipeline: pipelineName,
    runAt: new Date().toISOString(),
    rowsChecked,
    rowsPassed: rowsChecked,
    rowsRejected: 0,
    violations: { critical: 0, warning: 0, info: 0 },
    byField: {},
    reportPath: '',
  };
}
