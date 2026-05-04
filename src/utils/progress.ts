// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

/**
 * ProgressReporter — renders phase-by-phase progress feedback to stdout.
 *
 * Rendering decisions:
 *   silent               → no-op (nothing on stdout)
 *   logLevel = 'debug'   → bar disabled; phase transitions still logged by
 *                          the caller via the pino logger
 *   !isTTY               → one plain line per phase start + one per end
 *                          (no escape codes, no emojis, no colour)
 *   otherwise            → animated cli-progress bar with ETA for determinate
 *                          phases, rotating spinner for indeterminate phases
 *
 * The caller drives the state machine:
 *   startPhase(kind, label, { total? })
 *   update(rows)              // many times
 *   endPhase({ state, message? })   // success | warn | fail
 *   ...repeat for each phase...
 *   summary({ pipeline, elapsedMs, ... })
 *   stop()                    // always — put in try/finally
 */

import cliProgress from 'cli-progress';
import pc from 'picocolors';

export type PhaseKind = 'extract' | 'dq' | 'merge' | 'enrich' | 'transform' | 'load';

export type PhaseEndState = 'success' | 'warn' | 'fail';

export type ProgressLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StartPhaseOpts {
  total?: number;
}

export interface EndPhaseOpts {
  state?: PhaseEndState;
  message?: string;
}

export interface SummaryOpts {
  pipeline: string;
  elapsedMs: number;
  rowsExtracted?: number;
  rowsLoaded?: number;
  warnings?: number;
  state?: PhaseEndState;
}

export interface ProgressReporterOptions {
  silent?: boolean;
  totalPhases: number;
  logLevel?: ProgressLogLevel;
  /** Override for tests — defaults to `process.stdout.isTTY`. */
  isTTY?: boolean;
  /** Override for tests — defaults to `process.stdout`. */
  stdout?: NodeJS.WritableStream;
  /** Override for tests — defaults to `() => Date.now()`. */
  now?: () => number;
}

interface PhaseState {
  kind: PhaseKind;
  label: string;
  total: number | undefined;
  startMs: number;
  lastRows: number;
}

const PHASE_ICON_EMOJI: Record<PhaseKind, string> = {
  extract: '🔎',
  dq: '🛡️ ',
  merge: '🔀',
  enrich: '🌐',
  transform: '🔧',
  load: '📤',
};

// Plain-ASCII fallbacks used when the stream is not a TTY.
const PHASE_ICON_ASCII: Record<PhaseKind, string> = {
  extract: '[EX]',
  dq: '[DQ]',
  merge: '[MG]',
  enrich: '[EN]',
  transform: '[TX]',
  load: '[LD]',
};

const PHASE_COLOUR: Record<PhaseKind, (s: string) => string> = {
  extract: pc.cyan,
  dq: pc.yellow,
  merge: pc.magenta,
  enrich: pc.cyan,
  transform: pc.blue,
  load: pc.green,
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INDETERMINATE_TICK_MS = 100;

function formatRows(n: number): string {
  return n.toLocaleString('en-US');
}

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export class ProgressReporter {
  private readonly silent: boolean;
  private readonly totalPhases: number;
  private readonly stdout: NodeJS.WritableStream;
  private readonly isTTY: boolean;
  private readonly useBar: boolean;
  private readonly now: () => number;

  private phaseIndex = 0;
  private phase: PhaseState | null = null;
  private bar: cliProgress.SingleBar | null = null;
  private indeterminateTimer: NodeJS.Timeout | null = null;
  private indeterminateFrame = 0;
  private stopped = false;

  constructor(opts: ProgressReporterOptions) {
    this.silent = opts.silent ?? false;
    this.totalPhases = opts.totalPhases;
    this.stdout = opts.stdout ?? process.stdout;
    this.isTTY = opts.isTTY ?? Boolean((this.stdout as NodeJS.WriteStream).isTTY);
    this.now = opts.now ?? (() => Date.now());

    const barDisabled = opts.logLevel === 'debug';
    this.useBar = !this.silent && this.isTTY && !barDisabled;
  }

  startPhase(kind: PhaseKind, label: string, opts: StartPhaseOpts = {}): void {
    if (this.stopped) return;

    // If a previous phase was left open, close it quietly so we never leak a bar.
    if (this.phase) this.endPhase({ state: 'success' });

    this.phaseIndex++;
    this.phase = {
      kind,
      label,
      total: opts.total,
      startMs: this.now(),
      lastRows: 0,
    };

    if (this.silent) return;

    if (this.useBar) {
      if (opts.total !== undefined && opts.total > 0) {
        this.startDeterminateBar(opts.total);
      } else {
        this.startIndeterminatePulse();
      }
    } else {
      // Non-TTY / debug: single line on start. `endPhase` prints the closing line.
      this.writeLine(this.renderStartLine());
    }
  }

  update(rows: number): void {
    if (this.stopped || !this.phase) return;
    this.phase.lastRows = rows;
    if (this.silent) return;
    if (this.useBar && this.bar && this.phase.total !== undefined) {
      this.bar.update(Math.min(rows, this.phase.total));
    }
    // Indeterminate bar keeps its own animation timer; we just record lastRows.
  }

  endPhase(opts: EndPhaseOpts = {}): void {
    if (this.stopped || !this.phase) return;
    const state = opts.state ?? 'success';
    const rows = this.phase.lastRows;
    const elapsedMs = this.now() - this.phase.startMs;

    if (!this.silent) {
      if (this.useBar) {
        this.stopBar();
        this.writeLine(this.renderEndLine(state, rows, elapsedMs, opts.message));
      } else {
        this.writeLine(this.renderEndLine(state, rows, elapsedMs, opts.message));
      }
    }

    this.phase = null;
  }

  /** Final run summary banner. Safe to call when silent — no-ops. */
  summary(opts: SummaryOpts): void {
    if (this.silent) return;
    const state = opts.state ?? 'success';
    const marker = this.stateMarker(state);
    const bits: string[] = [];
    bits.push(marker);
    bits.push(pc.bold(opts.pipeline));
    if (opts.rowsExtracted !== undefined) {
      bits.push(`${formatRows(opts.rowsExtracted)} rows extracted`);
    }
    if (opts.warnings !== undefined && opts.warnings > 0) {
      bits.push(pc.yellow(`${formatRows(opts.warnings)} warnings`));
    }
    if (opts.rowsLoaded !== undefined) {
      bits.push(`${formatRows(opts.rowsLoaded)} loaded`);
    }
    bits.push(pc.dim(formatElapsed(opts.elapsedMs)));
    this.writeLine(bits.join(pc.dim(' · ')));
  }

  stop(): void {
    if (this.stopped) return;
    if (this.phase) {
      // Caller aborted mid-phase (e.g. thrown error). Close with failure state.
      // Set `stopped` after endPhase so the close line renders.
      this.endPhase({ state: 'fail' });
    }
    this.stopped = true;
    this.stopBar();
  }

  // ── Internal rendering ────────────────────────────────────────────────────

  private startDeterminateBar(total: number): void {
    const bar = new cliProgress.SingleBar(
      {
        format: this.formatDeterminate(),
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false,
        stream: this.stdout as NodeJS.WriteStream,
        fps: 10,
        noTTYOutput: false,
        forceRedraw: false,
      },
      cliProgress.Presets.shades_classic,
    );
    bar.start(total, 0);
    this.bar = bar;
  }

  private startIndeterminatePulse(): void {
    this.indeterminateFrame = 0;
    this.renderIndeterminate();
    this.indeterminateTimer = setInterval(() => {
      this.indeterminateFrame++;
      this.renderIndeterminate();
    }, INDETERMINATE_TICK_MS);
    if (typeof this.indeterminateTimer.unref === 'function') {
      this.indeterminateTimer.unref();
    }
  }

  private renderIndeterminate(): void {
    if (!this.phase) return;
    const spin = SPINNER_FRAMES[this.indeterminateFrame % SPINNER_FRAMES.length] ?? '.';
    const label = this.renderPhaseLabel();
    const rows = formatRows(this.phase.lastRows);
    const elapsed = formatElapsed(this.now() - this.phase.startMs);
    const line = `${label}  ${PHASE_COLOUR[this.phase.kind](spin)}  ${rows} rows · ${pc.dim(elapsed)}`;
    // Rewrite the current line: CR + clear-to-EOL.
    this.stdout.write(`\r${line}\x1b[K`);
  }

  private stopBar(): void {
    if (this.bar) {
      this.bar.stop();
      this.bar = null;
    }
    if (this.indeterminateTimer) {
      clearInterval(this.indeterminateTimer);
      this.indeterminateTimer = null;
      // Erase the in-flight indeterminate line.
      if (this.isTTY) this.stdout.write('\r\x1b[K');
    }
  }

  private renderStartLine(): string {
    const label = this.renderPhaseLabel();
    return `${label}  starting…`;
  }

  private renderEndLine(
    state: PhaseEndState,
    rows: number,
    elapsedMs: number,
    message: string | undefined,
  ): string {
    const label = this.renderPhaseLabel();
    const marker = this.stateMarker(state);
    const parts = [label, marker];
    if (rows > 0) parts.push(`${formatRows(rows)} rows`);
    parts.push(pc.dim(formatElapsed(elapsedMs)));
    if (message) parts.push(pc.dim(message));
    return parts.join('  ');
  }

  private renderPhaseLabel(): string {
    if (!this.phase) return '';
    const counter = pc.dim(`[${this.phaseIndex}/${this.totalPhases}]`);
    const icon = this.phaseIcon(this.phase.kind);
    const colourise = PHASE_COLOUR[this.phase.kind];
    const name = colourise(pc.bold(this.phase.label));
    return `${counter} ${icon} ${name}`;
  }

  private phaseIcon(kind: PhaseKind): string {
    return this.isTTY ? PHASE_ICON_EMOJI[kind] : PHASE_ICON_ASCII[kind];
  }

  private stateMarker(state: PhaseEndState): string {
    if (this.isTTY) {
      switch (state) {
        case 'success': return pc.bold(pc.green('✅'));
        case 'warn':    return pc.yellow('⚠️ ');
        case 'fail':    return pc.bold(pc.red('❌'));
      }
    }
    switch (state) {
      case 'success': return '[ok]';
      case 'warn':    return '[warn]';
      case 'fail':    return '[fail]';
    }
  }

  private formatDeterminate(): string {
    if (!this.phase) return '';
    const label = this.renderPhaseLabel();
    const colourise = PHASE_COLOUR[this.phase.kind];
    // cli-progress tokens: {bar} {value} {total} {eta_formatted} {duration_formatted}
    const bar = `${colourise('{bar}')}`;
    const counts = `{value}/{total} rows`;
    const eta = pc.dim(`ETA {eta_formatted}`);
    return `${label}  ${bar}  ${counts} · ${eta}`;
  }

  private writeLine(s: string): void {
    this.stdout.write(`${s}\n`);
  }
}

/**
 * Convenience factory for a silent reporter (tests, library callers).
 */
export function createSilentProgress(totalPhases = 0): ProgressReporter {
  return new ProgressReporter({ silent: true, totalPhases });
}
