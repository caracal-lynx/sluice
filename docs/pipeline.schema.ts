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
  type:        z.enum(['offset', 'cursor', 'page']),
  pageSize:    z.number().int().positive().default(100),
  pageParam:   z.string().optional(),
  totalField:  z.string().optional(),
  dataField:   z.string().optional(),
  cursorField: z.string().optional(),
  cursorParam: z.string().optional(),
});

// ── Source ────────────────────────────────────────────────────────────────────

export const SourceSchema = z.object({
  adapter:    SourceAd,
  connection: z.string().optional(),
  query:      z.string().optional(),
  file:       z.string().optional(),
  endpoint:   z.string().optional(),
  headers:    z.record(z.string()).optional(),
  delimiter:  z.string().default(','),
  encoding:   z.string().default('utf-8'),
  sheet:      z.union([z.string(), z.number()]).optional(),
  pagination: PaginationSchema.optional(),
}).refine(
  s => s.query || s.file || s.endpoint,
  { message: 'source must have query, file, or endpoint' }
);

// ── DQ ────────────────────────────────────────────────────────────────────────

const CheckType = z.enum([
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
  field:  z.string(),
  checks: z.array(CheckSchema).min(1),
});

export const DqSchema = z.object({
  rulesFile:      z.string().optional(),   // Phase 2: composite rule library path
  stopOnCritical: z.boolean().default(true),
  rejectionFile:  z.string().optional(),
  rules:          z.array(DqRuleSchema).default([]),
});

// ── Transform ─────────────────────────────────────────────────────────────────

const LookupSchema = z.object({
  name:   z.string(),
  source: SourceSchema,
  key:    z.string(),
  value:  z.string(),
});

const FieldType = z.enum([
  'string', 'number', 'decimal', 'boolean', 'date',
  'lookup', 'concat', 'constant', 'expression',
  'custom',    // Phase 2: delegates to a TransformPlugin via customOp
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
);

export const TransformSchema = z.object({
  lookups: z.array(LookupSchema).default([]),
  fields:  z.array(FieldMappingSchema).min(1),
});

// ── Target ────────────────────────────────────────────────────────────────────

export const TargetSchema = z.object({
  adapter:       TargetAd,
  output:        z.string().optional(),
  entity:        z.string().optional(),
  includeHeader: z.boolean().optional(),
  columnOrder:   z.array(z.string()).optional(),
  dateFormat:    z.string().optional(),
  delimiter:     z.string().default(','),
  encoding:      z.string().default('utf-8'),
  nullValue:     z.string().default(''),
  template:      z.string().optional(),
  // Business Central REST:
  baseUrl:       z.string().optional(),
  company:       z.string().optional(),
  apiVersion:    z.string().default('v2.0'),
  onConflict:    z.enum(['fail', 'upsert', 'ignore']).default('fail'),
  upsertKey:     z.array(z.string()).optional(),
  batchEndpoint: z.boolean().default(true),
  // PostgreSQL:
  table:         z.string().optional(),
  schema:        z.string().default('public'),
});

// ── Run ───────────────────────────────────────────────────────────────────────

export const RunSchema = z.object({
  mode:             z.enum(['full', 'incremental', 'validate-only']).default('full'),
  batchSize:        z.number().int().positive().default(500),
  onError:          z.enum(['continue', 'stop']).default('continue'),
  logLevel:         z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  dryRun:           z.boolean().default(false),
  outputDir:        z.string().default('./output'),
  stagingDb:        z.string().default(''),
  incrementalField: z.string().optional(),
  incrementalSince: z.string().optional(),
});

// ── Pipeline root ─────────────────────────────────────────────────────────────

export const PipelineSchema = z.object({
  pipeline: z.object({
    name:        z.string().regex(/^[a-z0-9-]+$/, 'name must be lowercase-hyphenated'),
    client:      z.string(),
    version:     z.string(),
    entity:      z.string(),
    description: z.string().optional(),
  }),
  source:    SourceSchema,
  dq:        DqSchema,
  transform: TransformSchema,
  target:    TargetSchema,
  run:       RunSchema.default({}),
});

// ── Phase 2: toolkit-level config (sluice.config.yaml) ───────────────────────

export const ToolkitConfigSchema = z.object({
  version: z.string(),
  plugins: z.array(z.object({
    package: z.string(),
    options: z.record(z.unknown()).optional(),
  })).default([]),
});

// ── Phase 2: composite rule library (shared/rules.yaml) ──────────────────────

export const CompositeRuleSchema = z.object({
  id:          z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  description: z.string().optional(),
  checks:      z.array(CheckSchema).min(1),
});

export const CompositeRuleLibrarySchema = z.object({
  version: z.string(),
  rules:   z.array(CompositeRuleSchema).min(1),
});

// ── Exported TypeScript types ─────────────────────────────────────────────────
// Use these everywhere — do not write manual interfaces for config types.

export type Pipeline            = z.infer<typeof PipelineSchema>;
export type SourceConfig        = z.infer<typeof SourceSchema>;
export type TargetConfig        = z.infer<typeof TargetSchema>;
export type RunConfig           = z.infer<typeof RunSchema>;
export type FieldMapping        = z.infer<typeof FieldMappingSchema>;
export type DqRule              = z.infer<typeof DqRuleSchema>;
export type CheckConfig         = z.infer<typeof CheckSchema>;
export type Lookup              = z.infer<typeof LookupSchema>;
export type ToolkitConfig       = z.infer<typeof ToolkitConfigSchema>;
export type CompositeRule       = z.infer<typeof CompositeRuleSchema>;
export type CompositeRuleLibrary = z.infer<typeof CompositeRuleLibrarySchema>;
