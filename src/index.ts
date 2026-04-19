export * from './config/index.js';
export * from './utils/index.js';
export * from './plugins/index.js';
export * from './staging/index.js';
export * from './adapters/source/index.js';
export { MultiSourcePipelineRunner } from './multi-source-runner.js';
export { MergeStrategyRegistry } from './merge/index.js';
export type { MergeStrategyPlugin, MergeSourceMeta, MergeResult } from './merge/index.js';
