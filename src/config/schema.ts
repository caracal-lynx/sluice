// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Sluice — pipeline config schema
 * @caracal-lynx/sluice
 *
 * Canonical Zod schema for all pipeline YAML configs.
 * All TypeScript types are inferred from these schemas — do not write
 * manual interfaces for anything that maps to pipeline config.
 *
 * Usage:
 *   import { PipelineSchema } from '@caracal-lynx/sluice';
 *   const pipeline = PipelineSchema.parse(yaml.load(fs.readFileSync('customers.pipeline.yaml', 'utf8')));
 *
 * ${ENV_VAR} strings in connection/url fields are resolved by ConfigLoader
 * before this schema is called — Zod sees plain strings, not tokens.
 */

import { z } from 'zod';

// ── Primitives ────────────────────────────────────────────────────────────────

const Severity   = z.enum(['critical', 'warning', 'info']);
const SourceAd   = z.enum(['mssql', 'pg', 'csv', 'xlsx', 'rest']);
const TargetAd   = z.enum(['bc', 'ifs', 'bluecherry', 'csv', 'pg', 'rest']);
const CleanseOps = z.string().regex(/^[a-zA-Z|:0-9]+$/);

// ── Pagination (REST source) ──────────────────────────────────────────────────

const PaginationSchema = z.object({
  type:        z.enum(['offset', 'cursor', 'page']).describe('Pagination strategy: `offset` (skip/take), `cursor` (next-cursor token), or `page` (1-indexed page number).'),
  pageSize:    z.number().int().positive().default(100).describe('Records to request per page.'),
  pageParam:   z.string().optional().describe('Query-string parameter name for the offset/page value (e.g. `skip`, `page`).'),
  totalField:  z.string().optional().describe('Dot-path to the total record count in the response body (used by `offset` and `page`).'),
  dataField:   z.string().optional().describe('Dot-path to the records array in the response body.'),
  cursorField: z.string().optional().describe('Field in the response body whose value is the cursor for the next page (used by `cursor`).'),
  cursorParam: z.string().optional().describe('Query-string parameter name to send the cursor in (used by `cursor`).'),
});

// ── Source ────────────────────────────────────────────────────────────────────

const SourceBaseSchema = z.object({
  adapter:    SourceAd.describe('Source adapter id. One of `mssql`, `pg`, `csv`, `xlsx`, `rest`.'),
  connection: z.string().optional().describe('Connection string for SQL adapters. Resolves `${ENV_VAR}` tokens at load time. Required for `mssql` and `pg`.'),
  query:      z.string().optional().describe('SELECT statement for SQL adapters. Required for `mssql` and `pg`.'),
  file:       z.string().optional().describe('Path or glob for file adapters. Required for `csv` and `xlsx`.'),
  endpoint:   z.string().optional().describe('Full URL for the `rest` adapter. Required for `rest`.'),
  headers:    z.record(z.string()).optional().describe('Optional HTTP headers, applied to every request from the `rest` adapter.'),
  delimiter:  z.string().default(',').describe('Field delimiter for the `csv` adapter.'),
  encoding:   z.string().default('utf-8').describe('File encoding for `csv` and `xlsx` (any Node-supported encoding).'),
  sheet:      z.union([z.string(), z.number()]).optional().describe('Sheet name or 0-based index for the `xlsx` adapter.'),
  pagination: PaginationSchema.optional().describe('Pagination config for the `rest` adapter. Omit for single-page responses.'),
});

export const SourceSchema = SourceBaseSchema.refine(
  s => s.query || s.file || s.endpoint,
  { message: 'source must have query, file, or endpoint' }
);

// ── DQ ────────────────────────────────────────────────────────────────────────

// Exported because (a) ConfigLoader needs .options at runtime to discriminate
// built-in checks from composite-rule references during expansion, and
// (b) plugin authors may want to introspect the built-in check set.
export const CheckType = z.enum([
  'notNull', 'unique', 'pattern', 'email', 'ukPostcode',
  'maxLength', 'min', 'max', 'allowedValues',
]);

const CheckSchema = z.object({
  type:     CheckType,
  value:    z.union([z.string(), z.number(), z.array(z.string())]).optional(),
  severity: Severity,
  message:  z.string().optional(),
});

const DqRuleSchema = z.object({
  field:    z.string(),
  sourceId: z.string().optional(),   // scopes a rule to a named source in multi-source pipelines; ignored in single-source mode
  checks:   z.array(CheckSchema).min(1),
});

export const DqSchema = z.object({
  rulesFile:      z.string().optional().describe('Optional path to a composite rule library YAML (Tier 1 plugins). Composite-rule references in `rules[]` are expanded into built-in checks before Zod validation.'),
  stopOnCritical: z.boolean().default(true).describe('When true, the pipeline halts (exit code 2) if any `critical` check fails. When false, critical violations are logged but the run continues.'),
  rejectionFile:  z.string().optional().describe('Path for the per-violation rejection CSV. Defaults to `{outputDir}/{pipeline.name}-rejected.csv`.'),
  rules:          z.array(DqRuleSchema).default([]).describe('List of DQ rules. Each entry binds a field to one or more checks.'),
});

// ── Enrich (Phase 4a) ─────────────────────────────────────────────────────────
//
// The framework that consumes these schemas — EnrichRegistry, EnrichmentRunner,
// EnrichCache, plugin loader, and built-in providers — lives in the private
// `@caracal-lynx/sluice-enrich` package and is not part of the open-source core.
// What ships here is the schema, the public `EnrichPlugin` interface
// (in src/enrich/types.ts), and the `registerEnrichPhase()` injection hook.

const EnrichWriteColumnsSchema = z
  .object({ valid: z.string() })   // 'valid' key is required
  .catchall(z.string());           // additional data-field mappings are optional

const EnrichLookupSchema = z.object({
  field:        z.string(),
  provider:     z.string(),
  writeColumns: EnrichWriteColumnsSchema,
  preValidate:  z.string().optional(),
  onError:      z.enum(['flag', 'skip', 'fail']).optional(),
  cache:        z.boolean().optional(),
  options:      z.record(z.unknown()).optional(),
});

export const EnrichSchema = z.object({
  cache:   z.union([z.boolean(), z.literal('persist')]).default(true).describe('Cache strategy for enrich providers. `true` = in-memory cache; `false` = no cache; `"persist"` = on-disk cache between runs.'),
  onError: z.enum(['flag', 'skip', 'fail']).default('flag').describe('Pipeline-wide error policy when an enrich call fails. `flag` = mark row but keep it; `skip` = drop the row; `fail` = halt the pipeline.'),
  lookups: z.array(EnrichLookupSchema).min(1).describe('At least one enrich lookup. Each binds a source field to a provider (e.g. VIES, HMRC) and writes the result into named columns.'),
});

// ── Transform ─────────────────────────────────────────────────────────────────

const LookupSchema = z.object({
  name:   z.string(),
  source: SourceSchema,
  key:    z.string(),
  value:  z.string(),
});

// ── Prep (Phase 12) ──────────────────────────────────────────────────────────
//
// Pre-enrich data fixup. Mutates a staging table in place so Enrich and DQ
// both see already-fixed data. See docs/PHASE-12-prep-phase-spec.md.

const PrepRuleSchema = z.object({
  field:      z.string().describe('Existing column to mutate in place.'),
  sourceId:   z.string().optional().describe('Multi-source only — scopes this rule to one pre-merge source. Rules with no sourceId run post-merge against stg_merged.'),
  when:       z.string().optional().describe('Optional row predicate (expr-eval; `js:` prefix for the vm sandbox). Falsy → rule skipped for that row.'),
  cleanse:    CleanseOps.optional().describe('Pipe-separated cleanse op chain — same syntax as transform.fields.cleanse. Exactly one of cleanse / expression / lookup must be set.'),
  expression: z.string().optional().describe('expr-eval expression, or `js:` prefix for the vm sandbox. Exactly one of cleanse / expression / lookup must be set.'),
  lookup:     z.string().optional().describe('Name of a prep.lookups entry. Exactly one of cleanse / expression / lookup must be set.'),
  onMiss:     z.enum(['keep', 'null', 'error']).default('keep').describe('Lookup miss behaviour. `keep` leaves the existing value untouched; `null` overwrites with SQL NULL; `error` throws PrepError (halts the run, ignores run.onError).'),
}).refine(
  r => [r.cleanse, r.expression, r.lookup].filter(v => v !== undefined && v !== '').length === 1,
  { message: 'prep rule must specify exactly one of cleanse, expression, lookup' },
).refine(
  r => r.onMiss === 'keep' || r.lookup !== undefined,
  { message: 'onMiss is only valid when lookup is set', path: ['onMiss'] },
);

export const PrepSchema = z.object({
  lookups:     z.array(LookupSchema).default([]).describe('Named lookup tables consumed by prep.rules[].lookup. Loaded once at the start of the prep phase. Cache is separate from transform.lookups in v1.'),
  rules:       z.array(PrepRuleSchema).min(1).describe('Prep rules — applied top-to-bottom against the staging table. Later rules see earlier rules’ mutations.'),
  summaryFile: z.string().optional().describe('Optional path for the prep summary JSON. Defaults to `{outputDir}/{pipeline.name}-prep-summary.json`.'),
});

const FieldType = z.enum([
  'string', 'number', 'decimal', 'boolean', 'date',
  'lookup', 'concat', 'constant', 'expression',
  'custom',    // Phase 2: delegates to a TransformPlugin via customOp
]);

// Field types that read from the source row — `from` must be set.
// `constant` emits a fixed value, `expression` evaluates against the full row,
// `custom` receives the whole row and chooses what to use — all three may omit `from`.
const TYPES_REQUIRING_FROM = new Set<string>([
  'string', 'number', 'decimal', 'boolean', 'date', 'lookup', 'concat',
]);

const FieldMappingSchema = z.object({
  from:      z.union([z.string(), z.array(z.string())]).optional(),
  to:        z.string(),
  type:      FieldType,
  max:       z.number().optional(),
  precision: z.number().optional(),
  format:    z.string().optional(),
  cleanse:   CleanseOps.optional(),
  lookup:    z.string().optional(),
  separator: z.string().optional(),
  value:     z.union([z.string(), z.number(), z.boolean()]).optional(),
  default:   z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  optional:  z.boolean().default(false),
  // Phase 2:
  customOp:  z.string().optional(),
  options:   z.record(z.unknown()).optional(),
}).refine(
  m => m.type !== 'custom' || !!m.customOp,
  { message: 'type: custom requires customOp to be set', path: ['customOp'] }
).refine(
  m => !TYPES_REQUIRING_FROM.has(m.type) || m.from !== undefined,
  { message: 'this field type requires "from" to be set', path: ['from'] }
);

export const TransformSchema = z.object({
  lookups: z.array(LookupSchema).default([]).describe('Named lookup tables, loaded once at the start of the transform phase and cached in memory. Any source adapter (CSV, MSSQL, REST, …) is valid here.'),
  fields:  z.array(FieldMappingSchema).min(1).describe('Field mappings — one entry per output column. Order is preserved.'),
});

// ── Target ────────────────────────────────────────────────────────────────────

export const TargetSchema = z.object({
  adapter:       TargetAd.describe('Target adapter id. Built-in: `csv`, `pg`. Paid add-ons: `bc`, `ifs`, `bluecherry`, `rest`.'),
  output:        z.string().optional().describe('Output file path for file-based targets (`csv`, `ifs`, `bluecherry`).'),
  entity:        z.string().optional().describe('Logical entity name. ERP adapters use this to resolve required-column lists; OData adapters use it as the entity-set name.'),
  connection:    z.string().optional().describe('Connection string for the `pg` adapter. Resolves `${ENV_VAR}` at load time.'),
  includeHeader: z.boolean().optional().describe('Whether to write a header row. Defaults: `csv` true, `ifs` false, `bluecherry` true.'),
  columnOrder:   z.array(z.string()).optional().describe('Explicit column ordering for file-based targets. Required by ERP imports that load by position rather than by name.'),
  dateFormat:    z.string().optional().describe('dayjs format token for date columns. Defaults: `YYYY-MM-DD` for `csv`/`ifs`, `MM/DD/YYYY` for `bluecherry`.'),
  delimiter:     z.string().default(',').describe('Field delimiter for file-based targets.'),
  encoding:      z.string().default('utf-8').describe('Output file encoding.'),
  nullValue:     z.string().default('').describe('Rendered value for null/undefined cells in CSV output.'),
  template:      z.string().optional().describe('Path to a header-only CSV template, used to override the default required-column ordering for `bluecherry`. The literal `default` selects the built-in column set.'),
  baseUrl:       z.string().optional().describe('Base URL for the `bc` adapter. Resolves `${ENV_VAR}`.'),
  company:       z.string().optional().describe('Company GUID or name for the `bc` adapter.'),
  apiVersion:    z.string().default('v2.0').describe('OData API version for the `bc` adapter.'),
  onConflict:    z.enum(['fail', 'upsert', 'ignore']).default('fail').describe('Behaviour when the target rejects an insert as a conflict. `upsert` issues a PATCH (`bc`) or INSERT … ON CONFLICT UPDATE (`pg`).'),
  upsertKey:     z.array(z.string()).optional().describe('Conflict key for `pg` upserts. **Required** when `onConflict: upsert`.'),
  batchEndpoint: z.boolean().default(true).describe('Use OData `$batch` for the `bc` adapter (max 100 ops per batch). Disable for adapters that don\'t support batching.'),
  table:         z.string().optional().describe('Target table name for the `pg` adapter.'),
  schema:        z.string().default('public').describe('Target schema for the `pg` adapter.'),
}).refine(
  t => t.onConflict !== 'upsert' || (t.upsertKey !== undefined && t.upsertKey.length > 0),
  { message: 'upsertKey is required when onConflict is "upsert"', path: ['upsertKey'] }
);

// ── Run ───────────────────────────────────────────────────────────────────────

export const RunSchema = z.object({
  mode:              z.enum(['full', 'incremental', 'validate-only']).default('full').describe('Run mode. `full` extracts and loads everything; `incremental` filters source records by `incrementalField`; `validate-only` runs DQ + transform but skips the load.'),
  batchSize:         z.number().int().positive().default(500).describe('DuckDB insert batch size during extract and transform.'),
  onError:           z.enum(['continue', 'stop']).default('continue').describe('Behaviour when a target adapter rejects a row. `continue` increments `rowsFailed`; `stop` aborts the load.'),
  logLevel:          z.enum(['debug', 'info', 'warn', 'error']).default('info').describe('pino log level. `debug` adds per-row progress lines and disables the progress bar.'),
  dryRun:            z.boolean().default(false).describe('When true, skip the load phase even if a target is configured. Equivalent to passing `--dry-run` on the command line.'),
  outputDir:         z.string().default('./output').describe('Base directory for run artefacts (rejection CSV, DQ summary JSON, run state JSON, default DuckDB staging file).'),
  stagingDb:         z.string().default('').describe('DuckDB staging file path. Empty string defaults to `{outputDir}/{pipeline.name}.duckdb`. Set to `:memory:` to force in-memory mode.'),
  enrichConcurrency: z.number().int().positive().default(5).describe('Phase 4a — concurrent in-flight enrich provider requests. Consumed by `@caracal-lynx/sluice-enrich` if installed.'),
  enrichTimeoutMs:   z.number().int().positive().default(5000).describe('Phase 4a — per-request timeout for enrich provider calls. Consumed by `@caracal-lynx/sluice-enrich` if installed.'),
  enrichMaxRetries:  z.number().int().min(0).max(5).default(3).describe('Phase 4a — max retries for enrich provider calls. Consumed by `@caracal-lynx/sluice-enrich` if installed.'),
  incrementalField:  z.string().optional().describe('Source column used to filter incremental runs (must be timestamp-coercible).'),
  incrementalSince:  z.string().optional().describe('ISO datetime override for the incremental window start. If empty, the runner reads `lastRunAt` from the state file.'),
});

// ── Multi-source merge ────────────────────────────────────────────────────────

const MergeFieldStrategySchema = z.object({
  field:    z.string(),
  strategy: z.enum(['coalesce', 'priority-override']).optional(),
  source:   z.string().optional(),   // named source id
}).refine(
  s => s.strategy !== undefined || s.source !== undefined,
  { message: 'fieldStrategy must specify strategy, source, or both' },
);

export const MergeSchema = z.object({
  key:               z.union([z.string(), z.array(z.string())]).describe('Merge key — single column name or array of columns (composite key). Must exist in every source after `rename` is applied.'),
  strategy:          z.enum(['coalesce', 'priority-override', 'union', 'intersect'])
                       .default('coalesce').describe('Merge strategy. `coalesce` = first non-null wins (priority-ordered); `priority-override` = highest-priority source always wins; `union` = all rows deduped by key; `intersect` = rows present in every source.'),
  onUnmatched:       z.enum(['include', 'exclude', 'warn', 'error']).default('include').describe('What to do with rows present in fewer than all sources. Ignored by `intersect`.'),
  fieldStrategies:   z.array(MergeFieldStrategySchema).default([]).describe('Per-field overrides of the top-level strategy. Use to pin a specific field to a specific source, or to override the strategy on a single field.'),
  conflictLog:       z.string().optional().describe('Optional CSV path to log per-conflict detail (key, field, winning source, source values). Only written when at least one conflict is detected.'),
  incrementalSource: z.string().optional().describe('Source id used for incremental filtering. Required when `run.mode: incremental`. Other sources run full each time.'),
});

export const MultiSourceEntrySchema = SourceBaseSchema.extend({
  id:       z.string().regex(/^[a-z0-9-]+$/, {
    message: 'source id must be lowercase alphanumeric with hyphens only',
  }).describe('Source id — lowercase alphanumeric with hyphens only. Must be unique across the array; used as the staging table suffix (`stg_raw_{id}`).'),
  priority: z.number().int().positive().describe('Positive integer priority. Lower priority = higher precedence in `coalesce` and `priority-override` strategies.'),
  rename:   z.record(z.string()).optional().describe('Optional rename map `{ "old column": "new column" }` applied in-place after extract. Useful for harmonising CSV/XLSX column headers; SQL/REST sources should rename in the query instead.'),
}).refine(
  s => s.query || s.file || s.endpoint,
  { message: 'source must have query, file, or endpoint' },
);

// ── Pipeline root ─────────────────────────────────────────────────────────────

const PipelineMetaSchema = z.object({
  name:        z.string().regex(/^[a-z0-9-]+$/, 'name must be lowercase-hyphenated'),
  client:      z.string(),
  version:     z.string(),
  entity:      z.string(),
  description: z.string().optional(),
});

export const PipelineSchema = z.object({
  pipeline:  PipelineMetaSchema,
  source:    SourceSchema.optional(),
  sources:   z.array(MultiSourceEntrySchema).min(2).optional(),
  merge:     MergeSchema.optional(),
  prep:      PrepSchema.optional(),     // Phase 12 — runs between Extract (+rename/merge) and Enrich
  enrich:    EnrichSchema.optional(),   // Phase 4a — runs between Extract/Merge and DQ
  dq:        DqSchema,
  transform: TransformSchema,
  target:    TargetSchema,
  run:       RunSchema.default({}),
}).refine(
  p => (!!p.source && !p.sources && !p.merge) || (!p.source && !!p.sources && !!p.merge),
  { message: 'pipeline must have either source (single) or both sources and merge (multi)' },
).refine(
  p => {
    if (!p.sources) return true;
    const ids = p.sources.map(s => s.id);
    return new Set(ids).size === ids.length;
  },
  { message: 'duplicate source ids in sources array' },
).refine(
  p => {
    if (!p.sources || !p.merge || p.run?.mode !== 'incremental') return true;
    return !!p.merge.incrementalSource;
  },
  { message: 'merge.incrementalSource is required when run.mode is incremental' },
).refine(
  p => {
    if (!p.sources || !p.merge || !p.merge.incrementalSource) return true;
    const ids = new Set(p.sources.map(s => s.id));
    return ids.has(p.merge.incrementalSource);
  },
  { message: 'merge.incrementalSource must match one of the source ids in sources' },
).refine(
  p => !p.prep || !!p.sources || p.prep.rules.every(r => r.sourceId === undefined),
  { message: 'prep.rules[].sourceId is only valid in multi-source pipelines' },
).refine(
  p => {
    if (!p.prep || !p.sources) return true;
    const ids = new Set(p.sources.map(s => s.id));
    return p.prep.rules.every(r => r.sourceId === undefined || ids.has(r.sourceId));
  },
  { message: 'prep.rules[].sourceId must match a declared source id' },
);

// ── Phase 2: toolkit-level config (sluice.config.yaml) ───────────────────────

export const ToolkitConfigSchema = z.object({
  version: z.string(),
  plugins: z.array(z.object({
    package: z.string(),
    options: z.record(z.unknown()).optional(),
  })).default([]),
});

// ── Phase 2: composite rule library (shared/rules.yaml) ──────────────────────

const BUILT_IN_CHECK_NAMES = new Set<string>(CheckType.options);

export const CompositeRuleSchema = z.object({
  id: z.string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
    .refine(id => !BUILT_IN_CHECK_NAMES.has(id), {
      message: 'composite rule id must not collide with a built-in check type',
    }),
  description: z.string().optional(),
  checks:      z.array(CheckSchema).min(1),
});

export const CompositeRuleLibrarySchema = z.object({
  version: z.string(),
  rules:   z.array(CompositeRuleSchema).min(1),
});

// ── Exported TypeScript types ─────────────────────────────────────────────────
// Use these everywhere — do not write manual interfaces for config types.

export type Pipeline             = z.infer<typeof PipelineSchema>;
export type SourceConfig         = z.infer<typeof SourceSchema>;
export type TargetConfig         = z.infer<typeof TargetSchema>;
export type RunConfig            = z.infer<typeof RunSchema>;
export type FieldMapping         = z.infer<typeof FieldMappingSchema>;
export type DqRule               = z.infer<typeof DqRuleSchema>;
export type CheckConfig          = z.infer<typeof CheckSchema>;
export type Lookup               = z.infer<typeof LookupSchema>;
export type ToolkitConfig        = z.infer<typeof ToolkitConfigSchema>;
export type CompositeRule        = z.infer<typeof CompositeRuleSchema>;
export type CompositeRuleLibrary = z.infer<typeof CompositeRuleLibrarySchema>;
export type MergeConfig          = z.infer<typeof MergeSchema>;
export type MultiSourceEntry     = z.infer<typeof MultiSourceEntrySchema>;
export type EnrichConfig         = z.infer<typeof EnrichSchema>;
export type EnrichLookupConfig   = z.infer<typeof EnrichLookupSchema>;
export type EnrichWriteColumns   = z.infer<typeof EnrichWriteColumnsSchema>;
export type PrepConfig           = z.infer<typeof PrepSchema>;
export type PrepRule             = z.infer<typeof PrepRuleSchema>;

// ── Type guards ───────────────────────────────────────────────────────────────

/** Narrows a Pipeline to one with a defined `source` (single-source pipeline). */
export function isSingleSource(p: Pipeline): p is Pipeline & { source: SourceConfig } {
  return p.source !== undefined;
}

/** Narrows a Pipeline to one with defined `sources` and `merge` (multi-source pipeline). */
export function isMultiSource(
  p: Pipeline,
): p is Pipeline & { sources: MultiSourceEntry[]; merge: MergeConfig } {
  return p.sources !== undefined;
}
