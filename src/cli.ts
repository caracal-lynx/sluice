#!/usr/bin/env node
/**
 * Sluice CLI.
 *
 * Commands (per CLAUDE.md):
 *   sluice run       <pipeline.yaml>   Full pipeline run
 *   sluice validate  <pipeline.yaml>   DQ + transform only; no load
 *   sluice profile   <pipeline.yaml>   Extract + column profiling; no DQ
 *   sluice check     <pipeline.yaml>   Config validation only; no execution
 *
 * Exit codes:
 *   0  success
 *   1  pipeline error
 *   2  DQ critical violations
 *   3  config error
 */

import { Command } from 'commander';
import * as path from 'node:path';

import { ConfigLoader } from './config/loader.js';
import { isMultiSource, type Pipeline } from './config/types.js';
import { MultiSourcePipelineRunner } from './multi-source-runner.js';
import { PipelineRunner, type RunOverrides } from './runner.js';
import { RuleRegistry, TransformRegistry, loadPlugins, loadNpmPlugins } from './plugins/index.js';
import { MergeStrategyRegistry } from './merge/index.js';
import { loadEnv } from './utils/env.js';
import { ConfigError, PipelineDQError, PipelineError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { ProgressReporter, type ProgressLogLevel } from './utils/progress.js';

interface GlobalOpts {
  env: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  output?: string;
  dryRun?: boolean;
  plugins?: string[];
  silent?: boolean;
}

export function resolvePluginDirs(cwd: string, pluginDirs: string[] = []): string[] {
  return Array.from(new Set([
    path.resolve(cwd, 'plugins'),
    ...pluginDirs.map((dir) => path.resolve(cwd, dir)),
  ]));
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof PipelineDQError) return 2;
  if (err instanceof ConfigError) return 3;
  if (err instanceof PipelineError) return 1;
  return 1;
}

function applyGlobals(opts: GlobalOpts): RunOverrides {
  loadEnv(opts.env);
  if (opts.logLevel) logger.level = opts.logLevel;
  if (opts.silent) {
    // Errors still reach stderr via the logger's multistream; info/warn are dropped.
    logger.level = 'error';
  }
  const overrides: RunOverrides = {};
  if (opts.output !== undefined) overrides.outputDir = opts.output;
  if (opts.dryRun) overrides.dryRun = true;
  if (opts.plugins?.length) overrides.pluginDirs = opts.plugins;
  return overrides;
}

function phaseCountForRun(config: Pipeline): number {
  const willLoad = !(config.run.dryRun || config.run.mode === 'validate-only');
  if (isMultiSource(config)) {
    const sourcesWithPreMergeRules = new Set(
      config.dq.rules.filter((r) => r.sourceId).map((r) => r.sourceId as string),
    );
    // Extract per source + DQ per source with rules + Merge + post-merge DQ + Transform [+ Load]
    return (
      config.sources.length +
      sourcesWithPreMergeRules.size +
      1 + // merge
      1 + // post-merge DQ
      1 + // transform
      (willLoad ? 1 : 0)
    );
  }
  // Single source: Extract + DQ + Transform [+ Load]
  return 3 + (willLoad ? 1 : 0);
}

function buildProgressReporter(opts: GlobalOpts, config: Pipeline): ProgressReporter {
  return new ProgressReporter({
    silent: opts.silent ?? false,
    totalPhases: phaseCountForRun(config),
    logLevel: (opts.logLevel ?? 'info') as ProgressLogLevel,
  });
}

export async function createRunnerForPipeline(
  yaml: string,
): Promise<PipelineRunner | MultiSourcePipelineRunner> {
  const config = await ConfigLoader.load(yaml);
  return isMultiSource(config)
    ? new MultiSourcePipelineRunner()
    : new PipelineRunner();
}

async function cmdRun(yaml: string, program: Command): Promise<never> {
  const opts = program.opts<GlobalOpts>();
  const overrides = applyGlobals(opts);
  let progress: ProgressReporter | undefined;
  try {
    const runner = await createRunnerForPipeline(yaml);
    const config = await ConfigLoader.load(yaml);
    progress = buildProgressReporter(opts, config);
    overrides.progress = progress;
    const result = await runner.run(yaml, overrides);
    logger.info(
      {
        pipeline: result.pipeline,
        mode: result.mode,
        rowsExtracted: result.extract.rowsExtracted,
        rowsMerged: result.merge?.rowsMerged,
        mergeConflicts: result.merge?.conflicts,
        unmatchedRows: result.merge?.unmatched,
        rowsLoaded: result.load?.rowsLoaded ?? 0,
        stateFile: result.stateFilePath,
      },
      'sluice run: complete',
    );
    process.exit(0);
  } catch (err) {
    progress?.stop();
    logger.error({ err }, 'sluice run: failed');
    process.exit(exitCodeFor(err));
  }
}

async function cmdValidate(yaml: string, program: Command): Promise<never> {
  const opts = program.opts<GlobalOpts>();
  const overrides = applyGlobals(opts);
  overrides.mode = 'validate-only';
  let progress: ProgressReporter | undefined;
  try {
    const runner = await createRunnerForPipeline(yaml);
    const config = await ConfigLoader.load(yaml);
    progress = buildProgressReporter(opts, { ...config, run: { ...config.run, mode: 'validate-only' } });
    overrides.progress = progress;
    const result = await runner.run(yaml, overrides);
    logger.info(
      {
        pipeline: result.pipeline,
        rowsMerged: result.merge?.rowsMerged,
        rowsChecked: result.dq.rowsChecked,
        critical: result.dq.violations.critical,
        warnings: result.dq.violations.warning,
      },
      'sluice validate: complete',
    );
    process.exit(0);
  } catch (err) {
    progress?.stop();
    logger.error({ err }, 'sluice validate: failed');
    process.exit(exitCodeFor(err));
  }
}

async function cmdProfile(yaml: string, program: Command): Promise<never> {
  const opts = program.opts<GlobalOpts>();
  const overrides = applyGlobals(opts);
  let progress: ProgressReporter | undefined;
  try {
    const runner = await createRunnerForPipeline(yaml);
    const config = await ConfigLoader.load(yaml);
    // profile = extract-only for single-source; extract+merge for multi-source.
    progress = new ProgressReporter({
      silent: opts.silent ?? false,
      totalPhases: isMultiSource(config) ? config.sources.length + 1 : 1,
      logLevel: (opts.logLevel ?? 'info') as ProgressLogLevel,
    });
    overrides.progress = progress;
    const result = await runner.profile(yaml, overrides);
    logger.info(
      { pipeline: result.pipeline, rowsExtracted: result.extract.rowsExtracted, profilePath: result.profilePath },
      'sluice profile: complete',
    );
    process.exit(0);
  } catch (err) {
    progress?.stop();
    logger.error({ err }, 'sluice profile: failed');
    process.exit(exitCodeFor(err));
  }
}

async function cmdCheck(yaml: string, program: Command): Promise<never> {
  applyGlobals(program.opts<GlobalOpts>());
  try {
    const config = await ConfigLoader.load(yaml);
    const isMulti = isMultiSource(config);
    logger.info(
      {
        pipeline: config.pipeline.name,
        source: config.source?.adapter ?? 'multi',
        sourceCount: isMulti ? config.sources.length : 1,
        mergeStrategy: isMulti ? config.merge.strategy : undefined,
        target: config.target.adapter,
        rules: config.dq.rules.length,
        fields: config.transform.fields.length,
      },
      'sluice check: config is valid',
    );
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'sluice check: failed');
    process.exit(exitCodeFor(err));
  }
}

async function cmdPlugins(program: Command): Promise<never> {
  const opts = program.opts<GlobalOpts>();
  const overrides = applyGlobals(opts);

  try {
    const cwd = process.cwd();
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();
    const pluginDirs = resolvePluginDirs(cwd, overrides.pluginDirs ?? []);

    // Load both tier 2 (file-based) and tier 3 (npm) plugins
    for (const dir of pluginDirs) {
      await loadPlugins(dir, ruleRegistry, transformRegistry, MergeStrategyRegistry);
    }

    const configPath = path.join(cwd, 'sluice.config.yaml');
    await loadNpmPlugins(configPath, ruleRegistry, transformRegistry, MergeStrategyRegistry);

    const ruleIds = ruleRegistry.list();
    const transformIds = transformRegistry.list();
    const mergeStrategyIds = MergeStrategyRegistry.list();

    logger.info(
      {
        rules: ruleIds,
        transforms: transformIds,
        mergeStrategies: mergeStrategyIds,
      },
      'sluice plugins: loaded',
    );
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'sluice plugins: failed');
    process.exit(exitCodeFor(err));
  }
}

async function cmdMergeListStrategies(program: Command): Promise<never> {
  const overrides = applyGlobals(program.opts<GlobalOpts>());
  try {
    const cwd = process.cwd();
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();
    const pluginDirs = resolvePluginDirs(cwd, overrides.pluginDirs ?? []);

    for (const dir of pluginDirs) {
      await loadPlugins(dir, ruleRegistry, transformRegistry, MergeStrategyRegistry);
    }

    const configPath = path.join(cwd, 'sluice.config.yaml');
    await loadNpmPlugins(configPath, ruleRegistry, transformRegistry, MergeStrategyRegistry);

    const strategyIds = MergeStrategyRegistry.list();
    const strategies = strategyIds.map((id) => {
      const strategy = MergeStrategyRegistry.get(id);
      return { id: strategy.id, description: strategy.description ?? strategy.id };
    });
    logger.info(
      { count: strategies.length, strategies },
      'sluice merge list-strategies: loaded',
    );
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'sluice merge list-strategies: failed');
    process.exit(exitCodeFor(err));
  }
}

async function cmdMergeInfo(strategyId: string, program: Command): Promise<never> {
  const overrides = applyGlobals(program.opts<GlobalOpts>());
  try {
    const cwd = process.cwd();
    const ruleRegistry = new RuleRegistry();
    const transformRegistry = new TransformRegistry();
    const pluginDirs = resolvePluginDirs(cwd, overrides.pluginDirs ?? []);

    for (const dir of pluginDirs) {
      await loadPlugins(dir, ruleRegistry, transformRegistry, MergeStrategyRegistry);
    }

    const configPath = path.join(cwd, 'sluice.config.yaml');
    await loadNpmPlugins(configPath, ruleRegistry, transformRegistry, MergeStrategyRegistry);

    const strategy = MergeStrategyRegistry.get(strategyId);

    logger.info(
      {
        strategy: strategy.id,
        description: strategy.description ?? strategy.id,
      },
      'sluice merge info: complete',
    );
    process.exit(0);
  } catch (err) {
    logger.error({ err, strategyId }, 'sluice merge info: failed');
    process.exit(exitCodeFor(err));
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('sluice')
    .description('Config-driven ETL toolkit for ERP data migrations')
    .version('0.1.0')
    .option('--log-level <level>', 'debug | info | warn | error')
    .option('--env <file>', 'Path to .env file', './.env')
    .option('--output <dir>', 'Override run.outputDir')
    .option('--plugins <dir...>', 'Additional plugin directory/directories to load')
    .option('--dry-run', 'Force run.dryRun = true')
    .option('--silent', 'Suppress the progress bar on stdout (logs still go to stderr)');

  program
    .command('run <pipeline>')
    .description('Execute a full pipeline run')
    .action((yaml: string) => {
      void cmdRun(yaml, program);
    });
  program
    .command('validate <pipeline>')
    .description('DQ + transform only; no load')
    .action((yaml: string) => {
      void cmdValidate(yaml, program);
    });
  program
    .command('profile <pipeline>')
    .description('Extract + column profiling; no DQ')
    .action((yaml: string) => {
      void cmdProfile(yaml, program);
    });
  program
    .command('check <pipeline>')
    .description('Validate config only; no execution')
    .action((yaml: string) => {
      void cmdCheck(yaml, program);
    });

  program
    .command('plugins')
    .description('List all loaded plugins (Tier 2 and Tier 3)')
    .action(() => {
      void cmdPlugins(program);
    });

  const mergeCmd = program
    .command('merge')
    .description('Merge strategy operations');

  mergeCmd
    .command('list-strategies')
    .description('List all available merge strategies')
    .action(() => {
      void cmdMergeListStrategies(program);
    });

  mergeCmd
    .command('info <strategy>')
    .description('Show details about a specific merge strategy')
    .action((strategyId: string) => {
      void cmdMergeInfo(strategyId, program);
    });

  return program;
}

// Only parse when invoked as the entry point (not when imported from tests).
const invoked = process.argv[1] ?? '';
if (
  invoked.endsWith('cli.ts') ||
  invoked.endsWith('cli.js') ||
  invoked.endsWith('sluice') ||
  invoked.endsWith('sluice.cmd')
) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((err) => {
      logger.error({ err }, 'sluice CLI: unexpected error');
      process.exit(1);
    });
}
