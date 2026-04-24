import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildProgram, exitCodeFor, resolvePluginDirs } from '../../src/cli.js';
import { ConfigError, PipelineDQError, PipelineError } from '../../src/utils/errors.js';

describe('CLI helpers', () => {
  it('maps known errors to expected exit codes', () => {
    expect(exitCodeFor(new PipelineDQError(1, 'report.json'))).toBe(2);
    expect(exitCodeFor(new ConfigError('bad config'))).toBe(3);
    expect(exitCodeFor(new PipelineError('pipeline failed'))).toBe(1);
    expect(exitCodeFor(new Error('unexpected'))).toBe(1);
  });

  it('deduplicates default and extra plugin directories', () => {
    const cwd = path.join(os.tmpdir(), 'repo', 'sluice');
    const dirs = resolvePluginDirs(cwd, ['./plugins', path.join(cwd, 'plugins'), './team/plugins']);

    expect(dirs).toEqual([
      path.resolve(cwd, 'plugins'),
      path.resolve(cwd, 'team', 'plugins'),
    ]);
  });

  it('always includes the default plugins directory', () => {
    const cwd = path.join(os.tmpdir(), 'repo', 'sluice');
    const dirs = resolvePluginDirs(cwd);

    expect(dirs).toEqual([path.resolve(cwd, 'plugins')]);
  });

  it('parses --silent as a global option', () => {
    const program = buildProgram();
    // parseOptions applies option values without dispatching the subcommand
    // action (which would call process.exit via cmdCheck).
    program.parseOptions(['--silent']);
    const opts = program.opts<{ silent?: boolean }>();
    expect(opts.silent).toBe(true);
  });

  it('--silent is not set by default', () => {
    const program = buildProgram();
    program.parseOptions([]);
    const opts = program.opts<{ silent?: boolean }>();
    expect(opts.silent).toBeUndefined();
  });
});
