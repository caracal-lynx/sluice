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
import { isMultiSource } from './config/types.js';
import { MultiSourcePipelineRunner } from './multi-source-runner.js';
import { PipelineRunner, type RunOverrides } from './runner.js';
import { RuleRegistry, TransformRegistry, loadPlugins, loadNpmPlugins } from './plugins/index.js';
import { MergeStrategyRegistry } from './merge/index.js';
import { loadEnv } from './utils/env.js';
import { ConfigError, PipelineDQError, PipelineError } from './utils/errors.js';
import { logger } from './utils/logger.js';

interface GlobalOpts {
  env: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  output?: string;
  dryRun?: boolean;
  plugins?: string[];
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
  const overrides: RunOverrides = {};
  if (opts.output !== undefined) overrides.outputDir = opts.output;
  if (opts.dryRun) overrides.dryRun = true;
  if (opts.plugins?.length) overrides.pluginDirs = opts.plugins;
  return overrides;
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
  const overrides = applyGlobals(program.opts<GlobalOpts>());
  try {
    const runner = await createRunnerForPipeline(yaml);
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
    logger.error({ err }, 'sluice run: failed');
    process.exit(exitCodeFor(err));
  }
}

async function cmdValidate(yaml: string, program: Command): Promise<never> {
  const overrides = applyGlobals(program.opts<GlobalOpts>());
  overrides.mode = 'validate-only';
  try {
    const runner = await createRunnerForPipeline(yaml);
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
    logger.error({ err }, 'sluice validate: failed');
    process.exit(exitCodeFor(err));
  }
}

async function cmdProfile(yaml: string, program: Command): Promise<never> {
  const overrides = applyGlobals(program.opts<GlobalOpts>());
  try {
    const runner = await createRunnerForPipeline(yaml);
    const result = await runner.profile(yaml, overrides);
    logger.info(
      { pipeline: result.pipeline, rowsExtracted: result.extract.rowsExtracted, profilePath: result.profilePath },
      'sluice profile: complete',
    );
    process.exit(0);
  } catch (err) {
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
        ruleCount: ruleIds.length,
        transformCount: transformIds.length,
        mergeStrategyCount: mergeStrategyIds.length,
      },
      'sluice plugins: loaded',
    );

    // Format output
    if (ruleIds.length === 0 && transformIds.length === 0 && mergeStrategyIds.length === 0) {
      console.log('No plugins loaded.');
      process.exit(0);
    }

    if (ruleIds.length > 0) {
      console.log('\n📋 Data Quality Rules:');
      ruleIds.forEach((id) => console.log(`  • ${id}`));
    }

    if (transformIds.length > 0) {
      console.log('\n🔄 Transform Operations:');
      transformIds.forEach((id) => console.log(`  • ${id}`));
    }

    if (mergeStrategyIds.length > 0) {
      console.log('\n🔀 Merge Strategies:');
      mergeStrategyIds.forEach((id) => console.log(`  • ${id}`));
    }

    console.log('');
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

    const strategies = MergeStrategyRegistry.list();
    logger.info({ count: strategies.length }, 'sluice merge list-strategies: loaded');

    if (strategies.length === 0) {
      console.log('No merge strategies loaded.');
      process.exit(0);
    }

    console.log('\n📚 Available Merge Strategies:\n');
    strategies.forEach((strategyId) => {
      try {
        const strategy = MergeStrategyRegistry.get(strategyId);
        console.log(`  ${strategy.id.padEnd(15)} ${strategy.description}`);
      } catch (err) {
        console.log(`  ${strategyId.padEnd(15)} (error loading strategy)`);
      }
    });
    console.log('');
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
    console.log(`\n📋 Merge Strategy: ${strategy.id}\n`);
    console.log(`Description:\n  ${strategy.description}\n`);
    
    // Add strategy-specific help text
    const helpText = {
      coalesce:
        `For each field, selects the first non-null value across sources,
  respecting the priority order. Whitespace-only values are skipped.
  
  Use case: Enriching primary source with fallback data from other sources.
  Example: IFS ERP data enriched with Excel lookup data.`,
      'priority-override':
        `For each field, uses the value from the highest-priority source
  present for the key, including nulls and whitespace.
  
  Use case: Strict priority-based source selection without null-coalescing.
  Example: Always trust primary system even if some fields are null.`,
      union:
        `Includes all rows from all sources, deduplicating by key.
  
  Use case: Combining independent data sources into a single entity.
  Example: Customer data from multiple regional systems.`,
      intersect:
        `Includes only rows present in ALL sources.
  
  Use case: Reconciliation and validation of matching records across sources.
  Example: Finding customers that exist in both legacy and new systems.`,
    };

    const text = helpText[strategyId as keyof typeof helpText];
    if (text) {
      console.log(`Usage:\n${text}\n`);
    }

    logger.info({ strategyId }, 'sluice merge info: complete');
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
    .option('--dry-run', 'Force run.dryRun = true');

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
