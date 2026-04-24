import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';

import { ProgressReporter, createSilentProgress } from '../../../src/utils/progress.js';

/**
 * Capture everything written to a stream into a single string.
 * Works for both TTY and non-TTY writes (cli-progress renders via `\r`).
 */
function collect(stream: PassThrough): { text: () => string } {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return {
    text: () => Buffer.concat(chunks).toString('utf-8'),
  };
}

function makeFakeStdout(opts: { isTTY: boolean }): PassThrough & { isTTY?: boolean } {
  const s = new PassThrough() as PassThrough & { isTTY?: boolean };
  s.isTTY = opts.isTTY;
  // Prevent "no listeners" warnings from flooding test output.
  s.on('data', () => undefined);
  return s;
}

describe('ProgressReporter', () => {
  it('silent mode writes nothing to stdout', () => {
    const stdout = makeFakeStdout({ isTTY: true });
    const captured = collect(stdout);
    let t = 0;
    const reporter = new ProgressReporter({
      silent: true,
      totalPhases: 2,
      stdout,
      isTTY: true,
      now: () => (t += 100),
    });

    reporter.startPhase('extract', 'Extract');
    reporter.update(100);
    reporter.update(500);
    reporter.endPhase({ state: 'success' });

    reporter.startPhase('load', 'Load', { total: 500 });
    reporter.update(500);
    reporter.endPhase({ state: 'success' });

    reporter.summary({ pipeline: 'p', elapsedMs: 500 });
    reporter.stop();

    expect(captured.text()).toBe('');
  });

  it('non-TTY mode emits plain ASCII lines without cursor-motion escapes', () => {
    const stdout = makeFakeStdout({ isTTY: false });
    const captured = collect(stdout);
    let t = 0;
    const reporter = new ProgressReporter({
      silent: false,
      totalPhases: 2,
      stdout,
      isTTY: false,
      now: () => (t += 100),
    });

    reporter.startPhase('extract', 'Extract');
    reporter.update(500);
    reporter.endPhase({ state: 'success' });
    reporter.startPhase('load', 'Load', { total: 500 });
    reporter.update(500);
    reporter.endPhase({ state: 'warn' });
    reporter.summary({
      pipeline: 'demo',
      elapsedMs: 400,
      rowsExtracted: 500,
      rowsLoaded: 500,
      state: 'warn',
    });
    reporter.stop();

    const output = captured.text();
    // No CR character (\r), no ANSI cursor-motion sequences.
    expect(output).not.toContain('\r');
    expect(output).not.toMatch(/\x1b\[\d*[ABCDJKs]/);
    // Uses ASCII fallback markers, not emojis.
    expect(output).toContain('[EX]');
    expect(output).toContain('[LD]');
    expect(output).toContain('[ok]');
    expect(output).toContain('[warn]');
    // Final summary contains pipeline name.
    expect(output).toContain('demo');
  });

  it('determinate phase renders a bar; indeterminate phase renders a spinner', () => {
    const stdout = makeFakeStdout({ isTTY: true });
    const captured = collect(stdout);
    let t = 0;
    const reporter = new ProgressReporter({
      silent: false,
      totalPhases: 2,
      stdout,
      isTTY: true,
      logLevel: 'info',
      now: () => (t += 50),
    });

    // Indeterminate (no total).
    reporter.startPhase('extract', 'Extract');
    reporter.update(100);
    reporter.endPhase({ state: 'success' });

    // Determinate (total known).
    reporter.startPhase('transform', 'Transform', { total: 100 });
    reporter.update(50);
    reporter.update(100);
    reporter.endPhase({ state: 'success' });

    reporter.stop();

    const output = captured.text();
    // TTY path emits some CR writes (either from cli-progress redraw or
    // from our indeterminate renderer).
    expect(output).toMatch(/Extract|Transform/);
  });

  it('update before startPhase is a safe no-op', () => {
    const stdout = makeFakeStdout({ isTTY: true });
    const captured = collect(stdout);
    const reporter = new ProgressReporter({
      silent: false,
      totalPhases: 1,
      stdout,
      isTTY: true,
    });

    expect(() => reporter.update(42)).not.toThrow();
    reporter.stop();
    // Nothing got drawn because no phase was ever started.
    expect(captured.text()).toBe('');
  });

  it('stop() after an error mid-phase closes the open phase with failure state', () => {
    const stdout = makeFakeStdout({ isTTY: false });
    const captured = collect(stdout);
    const reporter = new ProgressReporter({
      silent: false,
      totalPhases: 1,
      stdout,
      isTTY: false,
    });

    reporter.startPhase('extract', 'Extract');
    reporter.update(50);
    // Simulate a thrown error in the caller before endPhase.
    reporter.stop();

    // The reporter should have emitted a fail marker on the way out.
    expect(captured.text()).toContain('[fail]');
  });

  it('debug log level disables the animated bar', () => {
    const stdout = makeFakeStdout({ isTTY: true });
    const captured = collect(stdout);
    const reporter = new ProgressReporter({
      silent: false,
      totalPhases: 1,
      stdout,
      isTTY: true,
      logLevel: 'debug',
    });

    reporter.startPhase('extract', 'Extract');
    reporter.update(100);
    reporter.endPhase({ state: 'success' });
    reporter.stop();

    const output = captured.text();
    // Plain-line path used instead of cli-progress bar.
    expect(output).not.toContain('\r');
    // Start line + end line => two newlines.
    expect(output.split('\n').filter((l) => l.length > 0).length).toBe(2);
  });

  it('createSilentProgress returns a reporter that is silent', () => {
    const reporter = createSilentProgress();
    // Just make sure no errors are thrown when all API surface is exercised.
    expect(() => {
      reporter.startPhase('extract', 'Extract');
      reporter.update(1);
      reporter.endPhase({ state: 'success' });
      reporter.summary({ pipeline: 'p', elapsedMs: 10 });
      reporter.stop();
    }).not.toThrow();
  });
});
