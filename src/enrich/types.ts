// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

/**
 * Sluice — Phase 4a public enrich interfaces
 * @caracal-lynx/sluice
 *
 * Type-only public surface for the enrich subsystem. The implementation
 * (EnrichRegistry, EnrichmentRunner, EnrichCache, plugin loader, providers)
 * lives in the private `@caracal-lynx/sluice-enrich` package and is not
 * shipped with the open-source core.
 *
 * Third-party plugin authors implement `EnrichPlugin` here and drop a
 * `*.enrich.ts` file into a client `plugins/` directory. The private
 * package's loader picks them up at runtime via the registered phase factory.
 *
 * Unlike `RulePlugin` and `TransformPlugin` (Phase 2/3) — which are
 * contractually synchronous and pure — `EnrichPlugin.enrich()` is async.
 * It is the only plugin interface in Sluice that may perform I/O.
 */

import type { Logger } from 'pino';

import type {
  EnrichConfig,
  EnrichLookupConfig,
  RunConfig,
} from '../config/schema.js';
import type { StagingStore } from '../staging/store.js';

export interface EnrichOptions extends Record<string, unknown> {
  /** Per-call timeout in milliseconds. Inherited from RunConfig.enrichTimeoutMs. */
  timeoutMs: number;
  /** Retries per call (axios-retry exponential backoff). */
  maxRetries: number;
}

export interface EnrichResult {
  /** True if the external source confirms the value is valid/registered. */
  valid: boolean;
  /**
   * Additional data fields from the API response. Keys must match the
   * logical names used in `writeColumns` (excluding `valid`).
   */
  data?: Record<string, unknown>;
  /**
   * Set when the API call failed (timeout, 5xx, parse error).
   * Must NOT be set when `valid: false` is a legitimate "not found" answer.
   */
  error?: string;
  /** Set by EnrichCache; not populated by plugins. */
  fromCache?: boolean;
}

export interface EnrichPlugin {
  /** Unique kebab-case id; matches the `provider` key in pipeline YAML. */
  readonly id: string;
  /** Human-readable description for CLI output and error messages. */
  readonly description?: string;
  /**
   * Validate or enrich a single value against an external source.
   *
   * MUST be async; MUST NOT block the event loop.
   * MUST return EnrichResult — never throw, except for HTTP 429 which
   * should bubble out so axios-retry can apply exponential backoff.
   * MUST respect `options.timeoutMs`.
   */
  enrich(value: string, options: EnrichOptions): Promise<EnrichResult>;
}

export interface LookupSummary {
  provider: string;
  field: string;
  totalRows: number;
  validCount: number;
  errorCount: number;
  skipCount: number;
  cacheHits: number;
  /**
   * Populated when `writeColumns` includes a `consultation_ref` (or
   * similarly-named) reference key. Maps source field value → reference
   * string. Empty object when no consultation reference is in scope.
   */
  consultationRefs: Record<string, string>;
}

export interface EnrichSummary {
  lookups: LookupSummary[];
}

/**
 * Factory shape that `@caracal-lynx/sluice-enrich` registers via
 * `registerEnrichPhase()` on the open-source `PipelineRunner`. The runner
 * stores this factory and invokes it for every pipeline run that has an
 * `enrich:` block. If the factory is never registered (i.e. the private
 * package is not installed), the open-source runner skips the phase.
 */
export type EnrichPhaseFactory = (
  config: EnrichConfig,
  runConfig: RunConfig,
  staging: StagingStore,
  pluginDir: string,
  logger: Logger,
) => { run(): Promise<EnrichSummary> };

// Re-export the schema-derived config types alongside the public interfaces
// so plugin authors only need a single import path.
export type { EnrichConfig, EnrichLookupConfig };
