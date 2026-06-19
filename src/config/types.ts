// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

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
  PrepConfig,
  PrepRule,
} from "./schema.js";

export { isSingleSource, isMultiSource } from "./schema.js";
