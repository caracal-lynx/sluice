// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * PipelineRunner — the single entry point for a single-source Sluice pipeline.
 *
 * Public API: `run()` (and `profile()`). Everything else is decomposed into
 * `protected` phase methods so `MultiSourcePipelineRunner` can override each
 * phase cleanly. `runDQ` carries an unused `sourceId?: string` parameter used
 * by the multi-source runner when it filters per-source DQ rules.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ColumnMeta } from "./staging/index.js";

// The adapter barrels have a side effect that self-registers built-in adapters
// on first evaluation. Importing from them is sufficient — no extra "for side
// effect" import required.
import { SourceAdapterRegistry, type ExtractResult } from "./adapters/source/index.js";
import { TargetAdapterRegistry, type LoadResult } from "./adapters/target/index.js";
import { ConfigLoader } from "./config/loader.js";
import { isMultiSource } from "./config/schema.js";
import type { Pipeline } from "./config/types.js";
import { DQEngine, type DQSummary } from "./dq/index.js";
import type { EnrichPhaseFactory, EnrichSummary } from "./enrich/types.js";
import { MergeStrategyRegistry } from "./merge/index.js";
import { PrepEngine, PrepLookupResolver } from "./prep/index.js";
import type { PrepFiringResult, PrepSummary } from "./prep/index.js";
import { StagingStore, quoteIdent } from "./staging/index.js";
import { ExpressionEvaluator } from "./transform/expression.js";
import { TransformEngine, type TransformResult } from "./transform/index.js";
import { RuleRegistry, TransformRegistry } from "./plugins/registry.js";
import { loadPlugins, loadNpmPlugins } from "./plugins/loader.js";
import { ConfigError, PipelineDQError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
import { ProgressReporter, createSilentProgress } from "./utils/progress.js";
import { stringifyValue } from "./utils/stringify.js";

// ── Phase 4a — Enrich phase injection hook ─────────────────────────────────
//
// `@caracal-lynx/sluice-enrich` calls `registerEnrichPhase()` once at import
// time to inject its phase factory. If the private package is not installed,
// the slot stays undefined and `runEnrich()` no-ops with a WARN log so the
// operator notices the misconfiguration.

let _enrichPhaseFactory: EnrichPhaseFactory | undefined;

export function registerEnrichPhase(factory: EnrichPhaseFactory): void {
  _enrichPhaseFactory = factory;
}

/** Test-only helper. Not exported from `src/index.ts`. */
export function _resetEnrichPhaseForTesting(): void {
  _enrichPhaseFactory = undefined;
}

/** Test-only helper. Not exported from `src/index.ts`. */
export function _isEnrichPhaseRegistered(): boolean {
  return _enrichPhaseFactory !== undefined;
}

export interface RunResult {
  pipeline: string;
  mode: Pipeline["run"]["mode"];
  extract: ExtractResult;
  dq: DQSummary;
  transform: TransformResult | null;
  load: LoadResult | null;
  merge?: { rowsMerged: number; conflicts: number; unmatched: number };
  /** Phase 4a — populated when an `enrich:` block ran. */
  enrichSummary?: EnrichSummary;
  /** Phase 12 — populated when a `prep:` block ran (one or more firings). */
  prepSummary?: PrepSummary;
  /** Phase 12 — path to the prep summary JSON, when written. */
  prepSummaryPath?: string;
  /** Path to the state JSON written at the end of a successful run. */
  stateFilePath?: string;
  /** Set by `sluice profile`; absent for other commands. */
  profilePath?: string;
}

/** CLI-level overrides applied to the loaded Pipeline config. */
export interface RunOverrides {
  outputDir?: string;
  dryRun?: boolean;
  mode?: Pipeline["run"]["mode"];
  pluginDirs?: string[];
  /** Set by `sluice run --no-enrich` to skip the Phase 4a enrich phase. */
  skipEnrich?: boolean;
  /** Set by `sluice run --no-prep` / `sluice validate --no-prep` to skip the Phase 12 prep phase. */
  skipPrep?: boolean;
  /**
   * Override `run.stagingDb`. Pass `':memory:'` to force in-memory DuckDB
   * for a single invocation without rewriting the YAML on disk. Used by
   * the MCP server's `dry_run_pipeline` tool; CLI callers can leave it
   * undefined and rely on `run.stagingDb` from the config.
   */
  stagingDb?: string;
  /**
   * Optional progress reporter. CLI callers pass a live reporter; library
   * callers (and tests) can omit it to get a silent no-op.
   */
  progress?: ProgressReporter;
}

export class PipelineRunner {
  protected readonly ruleRegistry: RuleRegistry;
  protected readonly transformRegistry: TransformRegistry;
  protected readonly dqEngine: DQEngine;
  protected readonly transformEngine: TransformEngine;
  protected progress: ProgressReporter = createSilentProgress();
  private pluginsLoaded = false;
  private incrementalSinceUsed = "";
  /** Per-run prep state — reset at the top of every run/profile call. */
  protected prepResolver: PrepLookupResolver | undefined;
  protected prepEngine: PrepEngine | undefined;
  protected prepFirings: PrepFiringResult[] = [];

  constructor(ruleRegistry?: RuleRegistry, transformRegistry?: TransformRegistry) {
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
  /**
   * Load this runner's plugins and report the rule ids they registered, so a
   * caller can pass them to `ConfigLoader.load` (DAG-344).
   *
   * Idempotent — `loadAllPlugins` short-circuits on `pluginsLoaded`, so calling
   * this before `run()` costs nothing and registers nothing twice.
   */
  async loadPluginsFor(yamlPath: string, pluginDirs: string[] = []): Promise<string[]> {
    await this.loadAllPlugins(path.dirname(path.resolve(yamlPath)), pluginDirs);
    return this.ruleRegistry.list();
  }

  protected async loadAllPlugins(cwd: string, pluginDirs: string[] = []): Promise<void> {
    if (this.pluginsLoaded) return;

    const defaultPluginDir = path.join(cwd, "plugins");
    const allPluginDirs = Array.from(
      new Set([defaultPluginDir, ...pluginDirs.map((d) => path.resolve(d))]),
    );

    for (const pluginDir of allPluginDirs) {
      await loadPlugins(
        pluginDir,
        this.ruleRegistry,
        this.transformRegistry,
        MergeStrategyRegistry,
      );
    }

    const configPath = path.join(cwd, "sluice.config.yaml");
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
      "plugins: all loaded",
    );
  }

  async run(yamlPath: string, overrides: RunOverrides = {}): Promise<RunResult> {
    this.incrementalSinceUsed = "";
    this.prepResolver = undefined;
    this.prepEngine = undefined;
    this.prepFirings = [];
    if (overrides.progress) this.progress = overrides.progress;

    const runStartMs = Date.now();

    // Plugins first: ConfigLoader validates check ids against built-ins UNION the
    // registered plugin ids, so anything registering rules has to have run by now
    // (DAG-344). Safe to reorder — loadAllPlugins reads only the yaml path and the
    // overrides, never the parsed config.
    await this.loadAllPlugins(path.dirname(path.resolve(yamlPath)), overrides.pluginDirs ?? []);
    const loaded = await ConfigLoader.load(yamlPath, { rules: this.ruleRegistry.list() });
    const config = this.applyOverrides(loaded, overrides);
    logger.info(
      { pipeline: config.pipeline.name, yaml: yamlPath, mode: config.run.mode },
      "pipeline: start",
    );

    if (isMultiSource(config)) {
      throw new ConfigError(
        `Pipeline "${config.pipeline.name}" declares multiple sources. ` +
          "Use MultiSourcePipelineRunner to run multi-source pipelines.",
      );
    }

    if (config.run.mode === "incremental" && !config.run.incrementalField) {
      throw new ConfigError("run.incrementalField is required for incremental pipelines");
    }

    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const store = new StagingStore(this.resolveStagingDb(config));
    try {
      await store.open();

      const extractResult = await this.runExtract(config, store, "stg_raw");
      if (config.run.mode === "incremental" && config.run.incrementalField) {
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
            "pipeline: incremental filter applied",
          );
        }
      }

      // Phase 12 — Prep mutates stg_raw in place before Enrich and DQ.
      // Single-source pipelines have at most one firing (sourceId === undefined).
      await this.runPrep(config, store, overrides, extractResult.tableName, undefined);
      const prepSummary = await this.finalisePrepSummary(config);

      const enrichSummary = await this.runEnrich(
        config,
        store,
        path.dirname(path.resolve(yamlPath)),
        overrides,
        extractResult.tableName,
      );

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
        "stg_transformed",
      );

      if (config.run.dryRun || config.run.mode === "validate-only") {
        logger.info(
          { dryRun: config.run.dryRun, mode: config.run.mode },
          "pipeline: stopping before load",
        );
        this.progress.summary({
          pipeline: config.pipeline.name,
          elapsedMs: Date.now() - runStartMs,
          rowsExtracted: extractResult.rowsExtracted,
          warnings: dqSummary.violations.warning,
          state: dqSummary.violations.warning > 0 ? "warn" : "success",
        });
        return this.buildRunResult(
          config,
          extractResult,
          dqSummary,
          transformResult,
          null,
          enrichSummary,
          prepSummary,
        );
      }

      const loadResult = await this.runLoad(config, store);
      const stateFilePath = await this.writeStateFile(
        config,
        extractResult,
        dqSummary,
        loadResult,
        enrichSummary,
      );

      logger.info(
        {
          pipeline: config.pipeline.name,
          rowsExtracted: extractResult.rowsExtracted,
          rowsLoaded: loadResult.rowsLoaded,
        },
        "pipeline: done",
      );

      this.progress.summary({
        pipeline: config.pipeline.name,
        elapsedMs: Date.now() - runStartMs,
        rowsExtracted: extractResult.rowsExtracted,
        rowsLoaded: loadResult.rowsLoaded,
        warnings: dqSummary.violations.warning,
        state: dqSummary.violations.warning > 0 ? "warn" : "success",
      });

      return {
        ...this.buildRunResult(
          config,
          extractResult,
          dqSummary,
          transformResult,
          loadResult,
          enrichSummary,
          prepSummary,
        ),
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
    tableName = "stg_raw",
    phaseLabel = "Extract",
  ): Promise<ExtractResult> {
    if (!config.source) {
      throw new ConfigError(
        "runExtract called on a multi-source pipeline; use MultiSourcePipelineRunner",
      );
    }
    const adapter = SourceAdapterRegistry.get(config.source.adapter);
    this.progress.startPhase("extract", phaseLabel);
    // Staging DB files persist across runs. `CREATE TABLE IF NOT EXISTS`
    // (from buildCreateTableSql) would silently reuse an old table and cause
    // each run to append a fresh copy of the source data. Drop up-front so
    // every extract starts from an empty table.
    await store.dropTable(tableName);
    await adapter.connect(config.source);
    try {
      const result = await adapter.extract(
        config.source,
        store,
        config.run,
        (rows) => {
          logger.debug({ rows }, "extracting");
          this.progress.update(rows);
        },
        tableName,
      );
      logger.info(
        { rowsExtracted: result.rowsExtracted, table: result.tableName },
        "pipeline: extract complete",
      );
      this.progress.update(result.rowsExtracted);
      this.progress.endPhase({ state: "success" });
      return result;
    } catch (err) {
      this.progress.endPhase({ state: "fail" });
      throw err;
    } finally {
      await adapter.disconnect();
    }
  }

  protected async runDQ(
    config: Pipeline,
    store: StagingStore,
    tableName = "stg_raw",
    _sourceId?: string, // Reserved for per-source filtering in MultiSourcePipelineRunner.
    phaseLabel = "Data quality",
  ): Promise<DQSummary> {
    const total = (await store.tableExists(tableName))
      ? await store.rowCount(tableName)
      : undefined;
    this.progress.startPhase("dq", phaseLabel, total !== undefined ? { total } : {});
    try {
      const summary = await this.dqEngine.run(config, store, tableName, (rows) => {
        this.progress.update(rows);
      });
      logger.info(
        {
          rowsChecked: summary.rowsChecked,
          rowsRejected: summary.rowsRejected,
          critical: summary.violations.critical,
          warning: summary.violations.warning,
          info: summary.violations.info,
        },
        "pipeline: dq complete",
      );
      const state =
        summary.violations.critical > 0
          ? "fail"
          : summary.violations.warning > 0
            ? "warn"
            : "success";
      this.progress.endPhase({ state });
      return summary;
    } catch (err) {
      this.progress.endPhase({ state: "fail" });
      throw err;
    }
  }

  /**
   * Phase 4a enrich phase. No-ops (returns `undefined`) when:
   *   - the pipeline has no `enrich:` block;
   *   - `--no-enrich` was set (`overrides.skipEnrich`);
   *   - the run is `validate-only` or `dryRun`;
   *   - `@caracal-lynx/sluice-enrich` is not installed (no factory registered).
   *
   * The "not installed" case logs a WARN so an operator who configured an
   * `enrich:` block expecting it to run notices the misconfiguration.
   */
  protected async runEnrich(
    config: Pipeline,
    store: StagingStore,
    pluginDir: string,
    overrides: RunOverrides,
    sourceTable: string,
  ): Promise<EnrichSummary | undefined> {
    if (!config.enrich) return undefined;
    if (overrides.skipEnrich) {
      logger.info({ pipeline: config.pipeline.name }, "pipeline: enrich skipped (--no-enrich)");
      return undefined;
    }
    if (config.run.dryRun || config.run.mode === "validate-only") {
      logger.info(
        { mode: config.run.mode, dryRun: config.run.dryRun },
        "pipeline: enrich skipped (validate / dry run)",
      );
      return undefined;
    }
    if (!_enrichPhaseFactory) {
      logger.warn(
        { pipeline: config.pipeline.name },
        "pipeline: enrich block configured but @caracal-lynx/sluice-enrich is not installed — skipping",
      );
      return undefined;
    }

    this.progress.startPhase("enrich", "Enrich");
    try {
      const phase = _enrichPhaseFactory(
        config.enrich,
        config.run,
        store,
        pluginDir,
        logger,
        sourceTable,
      );
      const summary = await phase.run();
      logger.info({ lookups: summary.lookups.length }, "pipeline: enrich complete");
      this.progress.endPhase({ state: "success" });
      return summary;
    } catch (err) {
      this.progress.endPhase({ state: "fail" });
      throw err;
    }
  }

  protected async runTransform(
    config: Pipeline,
    store: StagingStore,
    sourceTable = "stg_raw",
    targetTable = "stg_transformed",
  ): Promise<TransformResult> {
    const total = (await store.tableExists(sourceTable))
      ? await store.rowCount(sourceTable)
      : undefined;
    this.progress.startPhase("transform", "Transform", total !== undefined ? { total } : {});
    try {
      const result = await this.transformEngine.run(
        config,
        store,
        sourceTable,
        targetTable,
        (rows) => this.progress.update(rows),
      );
      logger.info(
        {
          rowsIn: result.rowsIn,
          rowsOut: result.rowsOut,
          rowsFailed: result.rowsFailed,
          sourceTable,
          targetTable,
        },
        "pipeline: transform complete",
      );
      this.progress.endPhase({
        state: result.rowsFailed > 0 ? "warn" : "success",
      });
      return result;
    } catch (err) {
      this.progress.endPhase({ state: "fail" });
      throw err;
    }
  }

  protected async runLoad(config: Pipeline, store: StagingStore): Promise<LoadResult> {
    const adapter = TargetAdapterRegistry.get(config.target.adapter);
    const total = (await store.tableExists("stg_transformed"))
      ? await store.rowCount("stg_transformed")
      : undefined;
    this.progress.startPhase("load", "Load", total !== undefined ? { total } : {});
    await adapter.connect(config.target);
    try {
      const result = await adapter.load(config.target, store, config.run, (rows) => {
        logger.debug({ rows }, "loading");
        this.progress.update(rows);
      });
      logger.info(
        { rowsLoaded: result.rowsLoaded, outputPath: result.outputPath },
        "pipeline: load complete",
      );
      this.progress.update(result.rowsLoaded);
      this.progress.endPhase({
        state: result.rowsFailed > 0 ? "warn" : "success",
      });
      return result;
    } catch (err) {
      this.progress.endPhase({ state: "fail" });
      throw err;
    } finally {
      await adapter.disconnect();
    }
  }

  protected async writeStateFile(
    config: Pipeline,
    extract: ExtractResult,
    dq: DQSummary,
    load: LoadResult,
    enrichSummary?: EnrichSummary,
  ): Promise<string> {
    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    const stateFilePath = path.join(outputDir, `${config.pipeline.name}-state.json`);
    const state: Record<string, unknown> = {
      pipeline: config.pipeline.name,
      lastRunAt: new Date().toISOString(),
      lastMode: config.run.mode,
      rowsExtracted: extract.rowsExtracted,
      rowsLoaded: load.rowsLoaded,
      criticalViolations: dq.violations.critical,
      warnings: dq.violations.warning,
      incrementalSince: this.incrementalSinceUsed || (config.run.incrementalSince ?? ""),
    };
    // Omit the key entirely when no enrich phase ran, so existing pipelines
    // produce byte-for-byte identical state files.
    if (enrichSummary !== undefined) {
      state["enrichSummary"] = enrichSummary;
    }
    await fs.writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    logger.debug({ stateFilePath }, "pipeline: state file written");
    return stateFilePath;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * `sluice profile` entry point — extract only, then emit per-column stats.
   * Never writes an output CSV, never runs DQ or transforms.
   */
  async profile(yamlPath: string, overrides: RunOverrides = {}): Promise<RunResult> {
    this.prepResolver = undefined;
    this.prepEngine = undefined;
    this.prepFirings = [];
    if (overrides.progress) this.progress = overrides.progress;
    // Plugins first: ConfigLoader validates check ids against built-ins UNION the
    // registered plugin ids, so anything registering rules has to have run by now
    // (DAG-344). Safe to reorder — loadAllPlugins reads only the yaml path and the
    // overrides, never the parsed config.
    await this.loadAllPlugins(path.dirname(path.resolve(yamlPath)), overrides.pluginDirs ?? []);
    const loaded = await ConfigLoader.load(yamlPath, { rules: this.ruleRegistry.list() });
    const config = this.applyOverrides(loaded, overrides);
    if (isMultiSource(config)) {
      throw new ConfigError(
        `Pipeline "${config.pipeline.name}" declares multiple sources. ` +
          "Use MultiSourcePipelineRunner to profile multi-source pipelines.",
      );
    }
    if (config.run.mode === "incremental" && !config.run.incrementalField) {
      throw new ConfigError("run.incrementalField is required for incremental pipelines");
    }
    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const store = new StagingStore(this.resolveStagingDb(config));
    try {
      await store.open();
      const extractResult = await this.runExtract(config, store, "stg_raw");
      if (config.run.mode === "incremental" && config.run.incrementalField) {
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
            "pipeline: incremental filter applied (profile)",
          );
        }
      }

      const profile = await this.buildProfile(
        store,
        extractResult.tableName,
        extractResult.columns,
      );
      const profilePath = path.join(outputDir, `${config.pipeline.name}-profile.json`);
      await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
      logger.info({ profilePath, columns: profile.length }, "pipeline: profile complete");

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
    const rowCountRow = await store.query<{ n: unknown }>(`SELECT count(*) AS n FROM "${tbl}"`);
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
        sample: sampleRows.map((r) =>
          r["v"] === null || r["v"] === undefined ? null : stringifyValue(r["v"]),
        ),
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
    if (overrides.stagingDb !== undefined) run.stagingDb = overrides.stagingDb;
    return { ...config, run };
  }

  protected resolveStagingDb(config: Pipeline): string {
    if (config.run.stagingDb) return config.run.stagingDb;
    if (config.run.dryRun) return ":memory:";
    return path.join(path.resolve(config.run.outputDir), `${config.pipeline.name}.duckdb`);
  }

  protected async resolveIncrementalSince(config: Pipeline): Promise<string> {
    if (config.run.incrementalSince) return config.run.incrementalSince;

    const statePath = path.join(
      path.resolve(config.run.outputDir),
      `${config.pipeline.name}-state.json`,
    );

    try {
      const raw = await fs.readFile(statePath, "utf-8");
      const parsed = JSON.parse(raw) as { lastRunAt?: string };
      return typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : "";
    } catch {
      return "";
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

    const sinceCheck = await store.query<{ ts: unknown }>("SELECT TRY_CAST(? AS TIMESTAMP) AS ts", [
      incrementalSince,
    ]);
    if (sinceCheck[0]?.ts === null || sinceCheck[0]?.ts === undefined) {
      throw new ConfigError(`run.incrementalSince "${incrementalSince}" is not a valid timestamp`);
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
      "pipeline: filtered rejected rows before transform",
    );

    return acceptedTable;
  }

  protected buildRunResult(
    config: Pipeline,
    extract: ExtractResult,
    dq: DQSummary,
    transform: TransformResult | null,
    load: LoadResult | null,
    enrichSummary?: EnrichSummary,
    prepSummary?: PrepSummary,
  ): RunResult {
    const result: RunResult = {
      pipeline: config.pipeline.name,
      mode: config.run.mode,
      extract,
      dq,
      transform,
      load,
    };
    if (enrichSummary !== undefined) result.enrichSummary = enrichSummary;
    if (prepSummary !== undefined) result.prepSummary = prepSummary;
    return result;
  }

  // ── Phase 12 — Prep phase ─────────────────────────────────────────────

  /**
   * Run the prep phase once against `table` for `sourceId` (or against
   * `stg_raw` / `stg_merged` with `sourceId === undefined`). Subsequent calls
   * reuse the lazily-constructed PrepLookupResolver and PrepEngine, so prep
   * lookups are loaded at most once per pipeline run.
   *
   * No-ops when the pipeline has no `prep:` block or `--no-prep` was set.
   * Records the per-firing result on `this.prepFirings` for the summary file.
   * Unlike Enrich, Prep DOES run in dryRun and validate-only modes because DQ
   * depends on its output.
   */
  protected async runPrep(
    config: Pipeline,
    store: StagingStore,
    overrides: RunOverrides,
    table: string,
    sourceId: string | undefined,
  ): Promise<PrepFiringResult | undefined> {
    if (!config.prep) return undefined;
    if (overrides.skipPrep) {
      logger.info(
        { pipeline: config.pipeline.name, table, sourceId: sourceId ?? null },
        "pipeline: prep skipped (--no-prep)",
      );
      return undefined;
    }

    if (!this.prepResolver) {
      this.prepResolver = new PrepLookupResolver();
      if (config.prep.lookups.length > 0) {
        await this.prepResolver.loadAll(config.prep.lookups, config.run);
      }
    }
    if (!this.prepEngine) {
      this.prepEngine = new PrepEngine(store, this.prepResolver, new ExpressionEvaluator(), logger);
    }

    const phaseLabel = sourceId ? `Prep (${sourceId})` : "Prep";
    this.progress.startPhase("prep", phaseLabel);
    try {
      const firing = await this.prepEngine.run(table, config.prep, sourceId, config.run);
      this.prepFirings.push(firing);
      const failed = firing.rules.reduce((n, r) => n + r.rowsFailed, 0);
      this.progress.endPhase({ state: failed > 0 ? "warn" : "success" });
      return firing;
    } catch (err) {
      this.progress.endPhase({ state: "fail" });
      throw err;
    }
  }

  /**
   * Aggregate any captured prep firings into a PrepSummary and write the JSON
   * file (default `{outputDir}/{name}-prep-summary.json`, override via
   * `prep.summaryFile`). Returns `undefined` if prep didn't run.
   */
  protected async finalisePrepSummary(config: Pipeline): Promise<PrepSummary | undefined> {
    if (this.prepFirings.length === 0) return undefined;
    const summary: PrepSummary = {
      pipeline: config.pipeline.name,
      runAt: new Date().toISOString(),
      firings: this.prepFirings,
    };
    const defaultPath = path.join(
      path.resolve(config.run.outputDir),
      `${config.pipeline.name}-prep-summary.json`,
    );
    const summaryPath = config.prep?.summaryFile
      ? path.resolve(config.prep.summaryFile)
      : defaultPath;
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
    logger.info(
      { pipeline: config.pipeline.name, firings: summary.firings.length, summaryPath },
      "pipeline: prep summary written",
    );
    return summary;
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
    reportPath: "",
  };
}
