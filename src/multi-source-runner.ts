import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { type ExtractResult } from './adapters/source/index.js';
import { ConfigLoader } from './config/loader.js';
import { isMultiSource, type MultiSourceEntry, type Pipeline } from './config/types.js';
import type { DQSummary } from './dq/index.js';
import type { EnrichSummary } from './enrich/types.js';
import { MergeEngine } from './merge/index.js';
import { PipelineRunner, type RunOverrides, type RunResult } from './runner.js';
import { type ColumnMeta, StagingStore, quoteIdent } from './staging/index.js';
import { type LoadResult } from './adapters/target/index.js';
import { ConfigError, PipelineDQError } from './utils/errors.js';
import { logger } from './utils/logger.js';

interface SourceExtractMeta {
  sourceId: string;
  rowsExtracted: number;
  tableName: string;
}

function asColumns(names: string[]): ColumnMeta[] {
  return names.map((name) => ({ name, duckDbType: 'VARCHAR' }));
}

function sourceRejectionPath(config: Pipeline, sourceId: string): string | undefined {
  const configured = config.dq.rejectionFile;
  if (!configured) return undefined;
  const parsed = path.parse(configured);
  return path.join(parsed.dir, `${parsed.name}-${sourceId}${parsed.ext || '.csv'}`);
}

export class MultiSourcePipelineRunner extends PipelineRunner {
  private readonly mergeEngine = new MergeEngine();
  private sourceExtracts: SourceExtractMeta[] = [];
  private sourceIncrementalSince: Record<string, string> = {};

  // Keep merge ordering deterministic when two sources share the same priority.
  private sortSourcesForMerge(sources: MultiSourceEntry[]): MultiSourceEntry[] {
    return sources
      .map((source, index) => ({ source, index }))
      .sort((a, b) => {
        const byPriority = a.source.priority - b.source.priority;
        if (byPriority !== 0) return byPriority;
        return a.index - b.index;
      })
      .map((entry) => entry.source);
  }

  override async profile(yamlPath: string, overrides: RunOverrides = {}): Promise<RunResult> {
    if (overrides.progress) this.progress = overrides.progress;
    const loaded = await ConfigLoader.load(yamlPath);
    const config = this.applyOverrides(loaded, overrides);
    await this.loadAllPlugins(
      path.dirname(path.resolve(yamlPath)),
      overrides.pluginDirs ?? [],
    );

    if (!isMultiSource(config)) {
      throw new ConfigError(
        `Pipeline "${config.pipeline.name}" is not multi-source. Use PipelineRunner for single-source pipelines.`,
      );
    }
    if (config.run.mode === 'incremental') {
      throw new ConfigError('incremental mode is not implemented for multi-source profile');
    }

    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const store = new StagingStore(this.resolveStagingDb(config));
    try {
      await store.open();

      this.sourceExtracts = [];
      const sortedSources = this.sortSourcesForMerge(config.sources);
      for (const sourceEntry of sortedSources) {
        await this.extractOneSource(config, store, sourceEntry, false);
      }

      const mergeResult = await this.mergeEngine.run(
        store,
        sortedSources.map((s) => ({
          id: s.id,
          priority: s.priority,
          tableName: `stg_raw_${s.id}`,
        })),
        config.merge,
      );

      const mergedColumns = asColumns(await store.columnNames('stg_merged'));
      const profile = await this.buildProfileFromTable(store, 'stg_merged', mergedColumns);
      const profilePath = path.join(outputDir, `${config.pipeline.name}-profile.json`);
      await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8');
      logger.info({ profilePath, columns: profile.length }, 'pipeline: profile complete');

      const extractResult: ExtractResult = {
        rowsExtracted: this.sourceExtracts.reduce((sum, s) => sum + s.rowsExtracted, 0),
        tableName: mergeResult.tableName,
        columns: mergedColumns,
      };

      return {
        pipeline: config.pipeline.name,
        mode: config.run.mode,
        extract: extractResult,
        dq: {
          pipeline: config.pipeline.name,
          runAt: new Date().toISOString(),
          rowsChecked: mergeResult.rowsMerged,
          rowsPassed: mergeResult.rowsMerged,
          rowsRejected: 0,
          violations: { critical: 0, warning: 0, info: 0 },
          byField: {},
          reportPath: '',
        },
        transform: null,
        load: null,
        profilePath,
      };
    } finally {
      await store.close();
    }
  }

  override async run(yamlPath: string, overrides: RunOverrides = {}): Promise<RunResult> {
    if (overrides.progress) this.progress = overrides.progress;
    const runStartMs = Date.now();

    const loaded = await ConfigLoader.load(yamlPath);
    const config = this.applyOverrides(loaded, overrides);
    await this.loadAllPlugins(
      path.dirname(path.resolve(yamlPath)),
      overrides.pluginDirs ?? [],
    );

    if (!isMultiSource(config)) {
      throw new ConfigError(
        `Pipeline "${config.pipeline.name}" is not multi-source. Use PipelineRunner for single-source pipelines.`,
      );
    }
    if (config.run.mode === 'incremental' && !config.run.incrementalField) {
      throw new ConfigError('run.incrementalField is required for incremental multi-source pipelines');
    }

    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const store = new StagingStore(this.resolveStagingDb(config));
    try {
      await store.open();

      this.sourceExtracts = [];
      this.sourceIncrementalSince = Object.fromEntries(
        config.sources.map((s) => [s.id, '']),
      ) as Record<string, string>;
      const sortedSources = this.sortSourcesForMerge(config.sources);
      const incrementalSourceId = config.run.mode === 'incremental'
        ? config.merge.incrementalSource
        : undefined;
      const incrementalSince = incrementalSourceId
        ? await this.resolveIncrementalSinceForSource(config, incrementalSourceId)
        : '';

      if (incrementalSourceId) {
        this.sourceIncrementalSince[incrementalSourceId] = incrementalSince;
      }

      for (const sourceEntry of sortedSources) {
        await this.extractOneSource(
          config,
          store,
          sourceEntry,
          true,
          incrementalSourceId === sourceEntry.id ? incrementalSince : undefined,
        );
      }

      this.progress.startPhase('merge', `Merge (${config.merge.strategy ?? 'coalesce'})`);
      let mergeResult;
      try {
        mergeResult = await this.mergeEngine.run(
          store,
          sortedSources.map((s) => ({
            id: s.id,
            priority: s.priority,
            tableName: `stg_raw_${s.id}`,
          })),
          config.merge,
        );
        this.progress.update(mergeResult.rowsMerged);
        this.progress.endPhase({
          state: mergeResult.conflicts > 0 ? 'warn' : 'success',
        });
      } catch (err) {
        this.progress.endPhase({ state: 'fail' });
        throw err;
      }

      const postMergeConfig = this.buildPostMergeConfig(config);

      const enrichSummary = await this.runEnrich(
        postMergeConfig,
        store,
        path.dirname(path.resolve(yamlPath)),
        overrides,
      );

      const dqSummary = await this.runDQ(
        postMergeConfig,
        store,
        'stg_merged',
        undefined,
        'Data quality (post-merge)',
      );

      if (postMergeConfig.dq.stopOnCritical && dqSummary.violations.critical > 0) {
        throw new PipelineDQError(dqSummary.violations.critical, dqSummary.reportPath);
      }

      const mergedColumns = asColumns(await store.columnNames('stg_merged'));
      const transformSourceTable = await this.materializeAcceptedRows(
        store,
        'stg_merged',
        mergedColumns,
        dqSummary.rejectedRowIndices ?? [],
      );
      const transformResult = await this.runTransform(
        postMergeConfig,
        store,
        transformSourceTable,
        'stg_transformed',
      );

      const extractResult: ExtractResult = {
        rowsExtracted: this.sourceExtracts.reduce((sum, s) => sum + s.rowsExtracted, 0),
        tableName: mergeResult.tableName,
        columns: mergedColumns,
      };

      const baseRunResult = this.buildRunResult(
        postMergeConfig,
        extractResult,
        dqSummary,
        transformResult,
        null,
        enrichSummary,
      );
      const mergeSummary = {
        rowsMerged: mergeResult.rowsMerged,
        conflicts: mergeResult.conflicts,
        unmatched: mergeResult.unmatched,
      };

      if (postMergeConfig.run.dryRun || postMergeConfig.run.mode === 'validate-only') {
        logger.info(
          { dryRun: postMergeConfig.run.dryRun, mode: postMergeConfig.run.mode },
          'pipeline: stopping before load',
        );
        this.progress.summary({
          pipeline: postMergeConfig.pipeline.name,
          elapsedMs: Date.now() - runStartMs,
          rowsExtracted: extractResult.rowsExtracted,
          warnings: dqSummary.violations.warning,
          state: dqSummary.violations.warning > 0 || mergeResult.conflicts > 0 ? 'warn' : 'success',
        });
        return {
          ...baseRunResult,
          merge: mergeSummary,
        };
      }

      const loadResult = await this.runLoad(postMergeConfig, store);
      const stateFilePath = await this.writeStateFile(
        postMergeConfig,
        extractResult,
        dqSummary,
        loadResult,
        enrichSummary,
      );

      logger.info(
        {
          pipeline: postMergeConfig.pipeline.name,
          rowsMerged: mergeResult.rowsMerged,
          rowsLoaded: loadResult.rowsLoaded,
        },
        'pipeline: done (multi-source)',
      );

      this.progress.summary({
        pipeline: postMergeConfig.pipeline.name,
        elapsedMs: Date.now() - runStartMs,
        rowsExtracted: extractResult.rowsExtracted,
        rowsLoaded: loadResult.rowsLoaded,
        warnings: dqSummary.violations.warning,
        state: dqSummary.violations.warning > 0 || mergeResult.conflicts > 0 ? 'warn' : 'success',
      });

      return {
        ...this.buildRunResult(
          postMergeConfig,
          extractResult,
          dqSummary,
          transformResult,
          loadResult,
          enrichSummary,
        ),
        merge: mergeSummary,
        stateFilePath,
      };
    } finally {
      await store.close();
    }
  }

  protected override async writeStateFile(
    config: Pipeline,
    extract: ExtractResult,
    dq: DQSummary,
    load: LoadResult,
    enrichSummary?: EnrichSummary,
  ): Promise<string> {
    const outputDir = path.resolve(config.run.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    const stateFilePath = path.join(outputDir, `${config.pipeline.name}-state.json`);

    const sourcesBlock = Object.fromEntries(
      this.sourceExtracts.map((s) => [
        s.sourceId,
        {
          lastRunAt: new Date().toISOString(),
          rowsExtracted: s.rowsExtracted,
          incrementalSince: this.sourceIncrementalSince[s.sourceId] ?? '',
        },
      ]),
    );

    const state: Record<string, unknown> = {
      pipeline: config.pipeline.name,
      lastRunAt: new Date().toISOString(),
      lastMode: config.run.mode,
      rowsMerged: dq.rowsChecked,
      rowsLoaded: load.rowsLoaded,
      criticalViolations: dq.violations.critical,
      warnings: dq.violations.warning,
      incrementalSince: config.run.incrementalSince ?? '',
      sources: sourcesBlock,
    };
    if (enrichSummary !== undefined) {
      state['enrichSummary'] = enrichSummary;
    }

    await fs.writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    logger.debug({ stateFilePath }, 'pipeline: state file written');
    return stateFilePath;
  }

  private async extractOneSource(
    config: Pipeline,
    store: StagingStore,
    sourceEntry: MultiSourceEntry,
    runSourceDq = true,
    incrementalSince?: string,
  ): Promise<void> {
    const tableName = `stg_raw_${sourceEntry.id}`;
    const sourceScopedConfig = this.buildSingleSourceConfig(config, sourceEntry);

    const extractResult = await this.runExtract(
      sourceScopedConfig,
      store,
      tableName,
      `Extract (${sourceEntry.id})`,
    );
    this.sourceExtracts.push({
      sourceId: sourceEntry.id,
      rowsExtracted: extractResult.rowsExtracted,
      tableName,
    });

    if (sourceEntry.rename && Object.keys(sourceEntry.rename).length > 0) {
      await store.renameColumns(tableName, sourceEntry.rename);
    }

    if (incrementalSince && config.run.incrementalField) {
      await this.applyIncrementalFilterForSource(
        store,
        tableName,
        config.run.incrementalField,
        incrementalSince,
      );
      const filteredRows = await store.rowCount(tableName);
      const current = this.sourceExtracts.find((s) => s.sourceId === sourceEntry.id);
      if (current) current.rowsExtracted = filteredRows;
      logger.info(
        {
          sourceId: sourceEntry.id,
          tableName,
          incrementalField: config.run.incrementalField,
          incrementalSince,
          rowsAfterFilter: filteredRows,
        },
        'pipeline: incremental filter applied',
      );
    }

    if (!runSourceDq) return;

    const sourceRules = config.dq.rules.filter((r) => r.sourceId === sourceEntry.id);
    if (sourceRules.length === 0) return;

    const perSourceDqConfig: Pipeline = {
      ...sourceScopedConfig,
      dq: {
        ...sourceScopedConfig.dq,
        rejectionFile: sourceRejectionPath(config, sourceEntry.id),
        rules: sourceRules,
      },
    };
    const sourceSummary = await this.runDQ(
      perSourceDqConfig,
      store,
      tableName,
      sourceEntry.id,
      `Data quality (${sourceEntry.id})`,
    );

    if (config.dq.stopOnCritical && sourceSummary.violations.critical > 0) {
      throw new PipelineDQError(sourceSummary.violations.critical, sourceSummary.reportPath);
    }

    const currentColumns = asColumns(await store.columnNames(tableName));
    const acceptedTable = await this.materializeAcceptedRows(
      store,
      tableName,
      currentColumns,
      sourceSummary.rejectedRowIndices ?? [],
    );

    if (acceptedTable !== tableName) {
      await store.query(
        `CREATE OR REPLACE TABLE ${quoteIdent(tableName)} AS SELECT * FROM ${quoteIdent(acceptedTable)}`,
      );
      await store.dropTable(acceptedTable);
    }
  }

  private async resolveIncrementalSinceForSource(config: Pipeline, incrementalSourceId: string): Promise<string> {
    if (config.run.incrementalSince) return config.run.incrementalSince;

    const statePath = path.join(
      path.resolve(config.run.outputDir),
      `${config.pipeline.name}-state.json`,
    );
    try {
      const raw = await fs.readFile(statePath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        sources?: Record<string, { lastRunAt?: string }>;
      };
      const lastRunAt = parsed.sources?.[incrementalSourceId]?.lastRunAt;
      return typeof lastRunAt === 'string' ? lastRunAt : '';
    } catch {
      return '';
    }
  }

  private async applyIncrementalFilterForSource(
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
      const examples = await store.query<{ v: unknown }>(
        `
        SELECT DISTINCT ${quoteIdent(incrementalField)} AS v
        FROM ${quoteIdent(tableName)}
        WHERE ${quoteIdent(incrementalField)} IS NOT NULL
          AND TRY_CAST(${quoteIdent(incrementalField)} AS TIMESTAMP) IS NULL
        LIMIT 5
        `,
      );
      const sampleValues = examples
        .map((e) => (e.v === null || e.v === undefined ? '' : String(e.v)))
        .filter((v) => v.length > 0)
        .join(', ');
      throw new ConfigError(
        `incrementalField "${incrementalField}" contains ${invalidCount} non-parseable timestamp value(s)` +
        (sampleValues ? ` (examples: ${sampleValues})` : ''),
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

  private async buildProfileFromTable(
    store: StagingStore,
    tableName: string,
    columns: ColumnMeta[],
  ): Promise<Array<{
    name: string;
    duckDbType: string;
    rowCount: number;
    nullCount: number;
    distinctCount: number;
    minLen: number | null;
    maxLen: number | null;
    sample: Array<string | null>;
  }>> {
    const result: Array<{
      name: string;
      duckDbType: string;
      rowCount: number;
      nullCount: number;
      distinctCount: number;
      minLen: number | null;
      maxLen: number | null;
      sample: Array<string | null>;
    }> = [];

    const rowCountRow = await store.query<{ n: unknown }>(
      `SELECT count(*) AS n FROM ${quoteIdent(tableName)}`,
    );
    const rowCount = Number(rowCountRow[0]?.n ?? 0);

    for (const col of columns) {
      const qCol = quoteIdent(col.name);
      const [nullCountRow] = await store.query<{ n: unknown }>(
        `SELECT count(*) AS n FROM ${quoteIdent(tableName)} WHERE ${qCol} IS NULL`,
      );
      const [distinctRow] = await store.query<{ n: unknown }>(
        `SELECT count(DISTINCT ${qCol}) AS n FROM ${quoteIdent(tableName)}`,
      );
      const lenRow = await store.query<{ mn: unknown; mx: unknown }>(
        `SELECT min(length(CAST(${qCol} AS VARCHAR))) AS mn, max(length(CAST(${qCol} AS VARCHAR))) AS mx FROM ${quoteIdent(tableName)}`,
      );
      const sampleRows = await store.query<Record<string, unknown>>(
        `SELECT DISTINCT ${qCol} AS v FROM ${quoteIdent(tableName)} WHERE ${qCol} IS NOT NULL LIMIT 5`,
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
          r.v === null || r.v === undefined ? null : String(r.v),
        ),
      });
    }

    return result;
  }

  private buildSingleSourceConfig(config: Pipeline, sourceEntry: MultiSourceEntry): Pipeline {
    const next = {
      ...config,
      source: {
        adapter: sourceEntry.adapter,
        connection: sourceEntry.connection,
        query: sourceEntry.query,
        file: sourceEntry.file,
        endpoint: sourceEntry.endpoint,
        headers: sourceEntry.headers,
        delimiter: sourceEntry.delimiter,
        encoding: sourceEntry.encoding,
        sheet: sourceEntry.sheet,
        pagination: sourceEntry.pagination,
      },
    };
    delete (next as Record<string, unknown>)['sources'];
    delete (next as Record<string, unknown>)['merge'];
    return next as Pipeline;
  }

  private buildPostMergeConfig(config: Pipeline): Pipeline {
    // The merge phase has already produced stg_merged; downstream phases
    // (runDQ, runTransform, runLoad) never read config.source, so we drop
    // source/sources/merge to get a single-source-shaped config without
    // revalidating. Post-merge DQ rules are the ones without a sourceId.
    const postMergeRules = config.dq.rules.filter((r) => r.sourceId === undefined);
    const { source: _src, sources: _srcs, merge: _merge, ...rest } = config;
    void _src;
    void _srcs;
    void _merge;
    return {
      ...rest,
      dq: { ...config.dq, rules: postMergeRules },
    } as Pipeline;
  }
}
