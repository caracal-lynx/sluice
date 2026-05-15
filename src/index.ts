// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

export * from './config/index.js';
export * from './utils/index.js';
export * from './plugins/index.js';
export * from './staging/index.js';
export * from './adapters/source/index.js';
export * from './adapters/target/index.js';

// dq and transform barrels re-export RuleViolation (from plugins) and
// ColumnMeta (via staging). Re-export only the names that don't collide so
// consumers can still reach the engines and reporter from the package root.
export { DQEngine, writeRejectionCsv, writeSummaryJson, BUILT_IN_RULES } from './dq/index.js';
export type { Rule, DQSummary, ViolationCounts } from './dq/index.js';
export {
  applyCleanse,
  BUILTIN_CLEANSE_OPS,
  TransformEngine,
  ExpressionEvaluator,
  LookupResolver,
} from './transform/index.js';
export type { BuiltinCleanseOpInfo, TransformResult } from './transform/index.js';

export { PrepEngine, PrepLookupResolver } from './prep/index.js';
export type { PrepRuleResult, PrepFiringResult, PrepSummary } from './prep/index.js';

export { PipelineRunner, registerEnrichPhase } from './runner.js';
export type { RunResult, RunOverrides } from './runner.js';
export { MultiSourcePipelineRunner } from './multi-source-runner.js';
export { MergeEngine, MergeStrategyRegistry } from './merge/index.js';
export type { MergeStrategyPlugin, MergeSourceMeta, MergeResult } from './merge/index.js';
export type {
  EnrichPlugin,
  EnrichResult,
  EnrichOptions,
  EnrichSummary,
  LookupSummary,
  EnrichPhaseFactory,
} from './enrich/types.js';

// Re-export the pino Logger type so downstream packages (e.g.
// `@caracal-lynx/sluice-enrich`) can import it via the public path
// without taking a direct dependency on `pino`.
export type { Logger } from 'pino';
