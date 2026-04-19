/**
 * PipelineRunner — the single entry point for a single-source Sluice pipeline.
 *
 * Public API: `run()` (and `profile()`). Everything else is decomposed into
 * `protected` phase methods so `MultiSourcePipelineRunner` can override each
 * phase cleanly. `runDQ` carries an unused `sourceId?: string` parameter used
 * by the multi-source runner when it filters per-source DQ rules.
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
import { isMultiSource } from './config/schema.js';
import type { Pipeline } from './config/types.js';
import { DQEngine, type DQSummary } from './dq/index.js';
import { MergeStrategyRegistry } from './merge/index.js';
import { StagingStore, quoteIdent } from './staging/index.js';
import { TransformEngine, type TransformResult } from './transform/index.js';
import { RuleRegistry, TransformRegistry } from './plugins/registry.js';
import { loadPlugins, loadNpmPlugins } from './plugins/loader.js';
import { ConfigError, PipelineDQError } from './utils/errors.js';
import { logger } from './utils/logger.js';

export interface RunResult {
  pipeline: string;
  mode: Pipeline['run']['mode'];
  extract: ExtractResult;
  dq: DQSummary;
  transform: TransformResult | null;
  load: LoadResult | null;
  merge?: { rowsMerged: number; conflicts: number; unmatched: number };
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
  pluginDirs?: string[];
}

export class PipelineRunner {
  protected readonly ruleRegistry: RuleRegistry;
  protected readonly transformRegistry: TransformRegistry;
  protected readonly dqEngine: DQEngine;
  protected readonly transformEngine: TransformEngine;
  private pluginsLoaded = false;
  private incrementalSinceUsed = '';

  constructor(
    ruleRegistry?: RuleRegistry,
    transformRegistry?: TransformRegistry,
  ) {
    this.ruleRegistry = ruleRegistry ?? new RuleRegistry();
    this.transformRegistry = transformRegistry ?? new TransformRegistry();
    this.dqEngine = new DQEngine(this.ruleRegistry);
    this.transformEngine = new TransformEngine(this.transformRegistry);
  }

  /**
   * Load plugins from the file system and npm packages.
   * Called once per runner instance at the start of the first pipeline run.
   *
   * - Tier 2: Scans `{cwd}/plugins/` for `*.rule.{ts,js}` and `*.transform.{ts,js}`.
   * - Tier 3: Reads `{cwd}/sluice.config.yaml` for npm plugin declarations.
   */
  protected async loadAllPlugins(cwd: string, pluginDirs: string[] = []): Promise<void> {
    if (this.pluginsLoaded) return;

    const defaultPluginDir = path.join(cwd, 'plugins');
    const allPluginDirs = Array.from(new Set([
      defaultPluginDir,
      ...pluginDirs.map((d) => path.resolve(d)),
    ]));

    for (const pluginDir of allPluginDirs) {
      await loadPlugins(pluginDir, this.ruleRegistry, this.transformRegistry, MergeStrategyRegistry);
    }

    const configPath = path.join(cwd, 'sluice.config.yaml');
    await loadNpmPlugins(
      configPath,
      this.ruleRegistry,
      this.transformRegistry,
      MergeStrategyRegistry,
    );

    this.pluginsLoaded = true;
    logger.info(
      {
        rules: this.ruleRegistry.list().length,
        transforms: this.transformRegistry.list().length,
        pluginDirs: allPluginDirs,
      },
      'plugins: all loaded',
    );
  }

  async run(yamlPath: string, overrides: RunOverrides = {}): Promise<RunResult> {
    this.incrementalSinceUsed = '';

    const loaded = await ConfigLoader.load(yamlPath);
    const config = this.applyOverrides(loaded, overrides);
    await this.loadAllPlugins(
      path.dirname(path.resolve(yamlPath)),
      overrides.pluginDirs ?? [],
    );
    logger.info(
      { pipeline: config.pipeline.name, yaml: yamlPath, mode: config.run.mode },
      'pipeline: start',
    );

    if (isMultiSource(config)) {
      throw new ConfigError(
        `Pipeline "${config.pipeline.name}" declares multiple sources. ` +
        'Use MultiSourcePipelineRunner to run multi-source pipelines.',
      );
    }

    if (config.run.mode === 'incremental' && !config.run.incrementalField) {
      throw new ConfigError('run.incrementalField is required for incremental pipelines');
    }

    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const store = new StagingStore(this.resolveStagingDb(config));
    try {
      await store.open();

      const extractResult = await this.runExtract(config, store, 'stg_raw');
      if (config.run.mode === 'incremental' && config.run.incrementalField) {
        const incrementalSince = await this.resolveIncrementalSince(config);
        this.incrementalSinceUsed = incrementalSince;
        if (incrementalSince) {
          await this.applyIncrementalFilter(
            store,
            extractResult.tableName,
            config.run.incrementalField,
            incrementalSince,
          );
          extractResult.rowsExtracted = await store.rowCount(extractResult.tableName);
          logger.info(
            {
              tableName: extractResult.tableName,
              incrementalField: config.run.incrementalField,
              incrementalSince,
              rowsAfterFilter: extractResult.rowsExtracted,
            },
            'pipeline: incremental filter applied',
          );
        }
      }

      const dqSummary = await this.runDQ(config, store, extractResult.tableName);

      if (config.dq.stopOnCritical && dqSummary.violations.critical > 0) {
        throw new PipelineDQError(dqSummary.violations.critical, dqSummary.reportPath);
      }

      const transformSourceTable = await this.materializeAcceptedRows(
        store,
        extractResult.tableName,
        extractResult.columns,
        dqSummary.rejectedRowIndices ?? [],
      );

      const transformResult = await this.runTransform(
        config,
        store,
        transformSourceTable,
        'stg_transformed',
      );

      if (config.run.dryRun || config.run.mode === 'validate-only') {
        logger.info(
          { dryRun: config.run.dryRun, mode: config.run.mode },
          'pipeline: stopping before load',
        );
        return this.buildRunResult(config, extractResult, dqSummary, transformResult, null);
      }

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
    if (!config.source) {
      throw new ConfigError(
        'runExtract called on a multi-source pipeline; use MultiSourcePipelineRunner',
      );
    }
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
    _sourceId?: string, // Reserved for per-source filtering in MultiSourcePipelineRunner.
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
      incrementalSince: this.incrementalSinceUsed || (config.run.incrementalSince ?? ''),
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
    await this.loadAllPlugins(
      path.dirname(path.resolve(yamlPath)),
      overrides.pluginDirs ?? [],
    );
    if (isMultiSource(config)) {
      throw new ConfigError(
        `Pipeline "${config.pipeline.name}" declares multiple sources. ` +
        'Use MultiSourcePipelineRunner to profile multi-source pipelines.',
      );
    }
    if (config.run.mode === 'incremental' && !config.run.incrementalField) {
      throw new ConfigError('run.incrementalField is required for incremental pipelines');
    }
    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const store = new StagingStore(this.resolveStagingDb(config));
    try {
      await store.open();
      const extractResult = await this.runExtract(config, store, 'stg_raw');
      if (config.run.mode === 'incremental' && config.run.incrementalField) {
        const incrementalSince = await this.resolveIncrementalSince(config);
        if (incrementalSince) {
          await this.applyIncrementalFilter(
            store,
            extractResult.tableName,
            config.run.incrementalField,
            incrementalSince,
          );
          extractResult.rowsExtracted = await store.rowCount(extractResult.tableName);
          logger.info(
            {
              tableName: extractResult.tableName,
              incrementalField: config.run.incrementalField,
              incrementalSince,
              rowsAfterFilter: extractResult.rowsExtracted,
            },
            'pipeline: incremental filter applied (profile)',
          );
        }
      }

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

  protected applyOverrides(config: Pipeline, overrides: RunOverrides): Pipeline {
    if (Object.keys(overrides).length === 0) return config;
    const run = { ...config.run };
    if (overrides.outputDir !== undefined) run.outputDir = overrides.outputDir;
    if (overrides.dryRun !== undefined) run.dryRun = overrides.dryRun;
    if (overrides.mode !== undefined) run.mode = overrides.mode;
    return { ...config, run };
  }

  protected resolveStagingDb(config: Pipeline): string {
    if (config.run.stagingDb) return config.run.stagingDb;
    if (config.run.dryRun) return ':memory:';
    return path.join(
      path.resolve(config.run.outputDir),
      `${config.pipeline.name}.duckdb`,
    );
  }

  protected async resolveIncrementalSince(config: Pipeline): Promise<string> {
    if (config.run.incrementalSince) return config.run.incrementalSince;

    const statePath = path.join(
      path.resolve(config.run.outputDir),
      `${config.pipeline.name}-state.json`,
    );

    try {
      const raw = await fs.readFile(statePath, 'utf-8');
      const parsed = JSON.parse(raw) as { lastRunAt?: string };
      return typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : '';
    } catch {
      return '';
    }
  }

  protected async applyIncrementalFilter(
    store: StagingStore,
    tableName: string,
    incrementalField: string,
    incrementalSince: string,
  ): Promise<void> {
    const columns = await store.columnNames(tableName);
    if (!columns.includes(incrementalField)) {
      throw new ConfigError(
        `incrementalField "${incrementalField}" was not found in source table "${tableName}"`,
      );
    }

    const sinceCheck = await store.query<{ ts: unknown }>(
      'SELECT TRY_CAST(? AS TIMESTAMP) AS ts',
      [incrementalSince],
    );
    if (!sinceCheck[0]?.ts) {
      throw new ConfigError(
        `run.incrementalSince "${incrementalSince}" is not a valid timestamp`,
      );
    }

    const invalidRows = await store.query<{ n: unknown }>(
      `
      SELECT count(*) AS n
      FROM ${quoteIdent(tableName)}
      WHERE ${quoteIdent(incrementalField)} IS NOT NULL
        AND TRY_CAST(${quoteIdent(incrementalField)} AS TIMESTAMP) IS NULL
      `,
    );
    const invalidCount = Number(invalidRows[0]?.n ?? 0);
    if (invalidCount > 0) {
      throw new ConfigError(
        `incrementalField "${incrementalField}" contains ${invalidCount} non-parseable timestamp value(s)`,
      );
    }

    await store.query(
      `
      CREATE OR REPLACE TABLE ${quoteIdent(tableName)} AS
      SELECT *
      FROM ${quoteIdent(tableName)}
      WHERE TRY_CAST(${quoteIdent(incrementalField)} AS TIMESTAMP) >= TRY_CAST(? AS TIMESTAMP)
      `,
      [incrementalSince],
    );
  }

  protected async materializeAcceptedRows(
    store: StagingStore,
    tableName: string,
    columns: ColumnMeta[],
    rejectedRowIndices: number[],
  ): Promise<string> {
    if (rejectedRowIndices.length === 0) return tableName;

    const rejected = new Set(rejectedRowIndices);
    const rows = await store.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdent(tableName)}`,
    );
    const acceptedRows = rows.filter((_row, index) => !rejected.has(index));
    const acceptedTable = `${tableName}_accepted`;

    await store.dropTable(acceptedTable);
    await store.createTable(acceptedTable, columns);
    if (acceptedRows.length > 0) {
      await store.insertBatch(acceptedTable, acceptedRows);
    }

    logger.info(
      {
        sourceTable: tableName,
        acceptedTable,
        rejectedRows: rejectedRowIndices.length,
        acceptedRows: acceptedRows.length,
      },
      'pipeline: filtered rejected rows before transform',
    );

    return acceptedTable;
  }

  protected buildRunResult(
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
