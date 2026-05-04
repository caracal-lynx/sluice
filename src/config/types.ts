export type {
  Pipeline,
  SourceConfig,
  TargetConfig,
  RunConfig,
  FieldMapping,
  DqRule,
  CheckConfig,
  Lookup,
  ToolkitConfig,
  CompositeRule,
  CompositeRuleLibrary,
  MergeConfig,
  MultiSourceEntry,
  EnrichConfig,
  EnrichLookupConfig,
  EnrichWriteColumns,
} from './schema.js';

export { isSingleSource, isMultiSource } from './schema.js';
