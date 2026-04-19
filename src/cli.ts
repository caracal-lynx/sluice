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

import { ConfigLoader } from './config/loader.js';
import { PipelineRunner, type RunOverrides } from './runner.js';
import { loadEnv } from './utils/env.js';
import { ConfigError, PipelineDQError, PipelineError } from './utils/errors.js';
import { logger } from './utils/logger.js';

interface GlobalOpts {
  env: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  output?: string;
  dryRun?: boolean;
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
  return overrides;
}

async function cmdRun(yaml: string, program: Command): Promise<never> {
  const overrides = applyGlobals(program.opts<GlobalOpts>());
  try {
    const result = await new PipelineRunner().run(yaml, overrides);
    logger.info(
      {
        pipeline: result.pipeline,
        mode: result.mode,
        rowsExtracted: result.extract.rowsExtracted,
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
    const result = await new PipelineRunner().run(yaml, overrides);
    logger.info(
      {
        pipeline: result.pipeline,
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
    const result = await new PipelineRunner().profile(yaml, overrides);
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
    logger.info(
      {
        pipeline: config.pipeline.name,
        source: config.source.adapter,
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

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('sluice')
    .description('Config-driven ETL toolkit for ERP data migrations')
    .version('0.1.0')
    .option('--log-level <level>', 'debug | info | warn | error')
    .option('--env <file>', 'Path to .env file', './.env')
    .option('--output <dir>', 'Override run.outputDir')
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
