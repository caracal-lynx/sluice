# Sluice MCP Server — Specification
# `@caracal-lynx/sluice-mcp`
# Owner: Michael Scott, Caracal Lynx Limited (SC826823)
# Status: Specification — not yet implemented
# Depends on: CLAUDE.md (Phase 1 complete), PHASE2-EXTENSIONS.md (Phase 3 complete)
# Last updated: 2026-04-28

# ⚠️  COMMERCIAL STATUS: PRIVATE PAID SERVICE
# ─────────────────────────────────────────────────────────────────────────────
# @caracal-lynx/sluice-mcp is NOT part of the open-source Sluice CLI.
# It is a PRIVATE commercial offering from Caracal Lynx Limited.
#
# - GitHub repository: caracal-lynx/sluice-mcp (PRIVATE)
# - npm package: @caracal-lynx/sluice-mcp (PRIVATE — Pro plan)
# - Not published to the public npm registry
# - Provided to clients under a paid engagement with Caracal Lynx
# - Clients receive a read-only NPM_TOKEN to install the package
#
# The open-source @caracal-lynx/sluice core package does NOT include
# the MCP server. The MCP server depends on the core (peer dep) but
# is developed, versioned, and distributed separately.
# ─────────────────────────────────────────────────────────────────────────────

---

## 1. Purpose and Context

### 1.1 What this package is

`@caracal-lynx/sluice-mcp` is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that exposes the Sluice ETL pipeline toolkit to AI assistants (Claude, Claude Code) as callable tools.

Without this package, an AI assistant helping with a Sluice migration can only **generate artifacts** (YAML, TypeScript files) — it must tell the human to run the CLI and paste back the results. With this package, the AI can:

- Validate and execute pipelines directly
- Inspect source database schemas before writing field mappings
- Detect mapping gaps (source columns with no mapping, or mappings referencing non-existent columns)
- Write validated YAML files to disk
- Scaffold skeleton plugin files
- Read run state and iterate automatically on rejections

This closes the agentic feedback loop: the AI generates → executes → inspects results → self-corrects, with human approval only before the live run.

### 1.2 Relationship to existing Sluice packages

```
@caracal-lynx/sluice          ← Phase 1: core engine (COMPLETE)
  └── src/
      ├── config/              ← Zod schema + YAML loader
      ├── adapters/            ← mssql, pg, csv, xlsx, rest, bc, ifs, bluecherry
      ├── dq/engine.ts         ← DQ validation engine
      ├── transform/engine.ts  ← Transform engine
      └── runner.ts            ← PipelineRunner orchestrator

@caracal-lynx/sluice-mcp      ← THIS PACKAGE (to be built)
  └── wraps the above via PipelineRunner.fromFile() and direct DB connections
```

The MCP server is a **sibling package** in the monorepo. It imports from `@caracal-lynx/sluice` (declared as `workspace:*` in package.json) and does not duplicate any engine logic.

### 1.3 Relationship to Claude Code Skills

Sluice uses two complementary AI integration mechanisms:

| Mechanism | Layer | What it does |
|-----------|-------|--------------|
| Skills (`skills/create-sluice-rule/`, etc.) | Intelligence | Prompt-based guidance: teaches Claude _how_ to write valid Sluice YAML and TypeScript |
| MCP server (this package) | Execution | Tool-based access: gives Claude _hands_ to execute, inspect, and iterate |

Skills tell the AI what to do. The MCP server lets it actually do it. Both are required for the full agentic intake-to-migration workflow.

---

## 2. Prerequisites

Before implementing this package, ensure the following are true:

1. **Phase 1 is complete and all tests passing** — confirmed as of 2026-04-15.
2. **Phase 2 plugin system is complete** — the `RulePlugin` and `TransformPlugin` interfaces must exist in `src/plugins/types.ts` before the scaffold handlers can reference them in generated code.
3. **`PipelineRunner.fromFile()` is exposed** — the pipeline handlers require a static factory method that loads a pipeline from a YAML file path and accepts an `overrides` object for `run.*` config. If this doesn't exist yet, add it before implementing Phase 3 of the MCP build.
4. **Monorepo workspace configured** — `packages/sluice-mcp` must be listed as a workspace member in the root `package.json` (pnpm/npm workspaces).

---

## 3. TypeScript and Project Conventions

This package follows the same conventions as `@caracal-lynx/sluice`. **Do not deviate from these rules.**

| Rule | Detail |
|------|--------|
| Language | TypeScript 6 strict mode |
| Runtime | Node.js 24 LTS (`engines.node >= 24`) |
| Module system | ESM (`"type": "module"`, `"module": "NodeNext"`) — all imports use `.js` extension |
| Strict flags | `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride` |
| Logging | `pino` only — **no `console.log` or `console.error` anywhere in `src/`** |
| Validation | `zod` v3 — all external input validated before use |
| Testing | `vitest` only — no Jest |
| Dev execution | `tsx` — no `ts-node` |
| Date handling | `dayjs` — import plugins explicitly at call site |
| Expressions | `expr-eval` for safe expressions — no `eval()`, no `new Function()` |
| Path handling | Always `path.join()` / `path.resolve()` — never string concatenation |
| Credentials | Never hardcoded — always `${ENV_VAR}` tokens resolved from `process.env` |

### 3.1 Logging convention

```typescript
// All module-level loggers
const logger = pino({ name: 'mcp:<module-name>' });

// Use structured logging
logger.info({ filePath, dryRun }, 'run_pipeline');
logger.error({ err }, 'run_pipeline failed');
```

Logs go to **stderr** — stdout is reserved exclusively for the MCP stdio protocol. This is enforced in `src/index.ts` by configuring pino's transport destination to `2` (stderr).

### 3.2 Error handling convention

MCP tool handlers **do not throw**. All errors are caught and returned as `{ error: string }`. The server dispatcher (`src/server.ts`) detects this shape and sets `isError: true` in the MCP response. This allows the AI to read the error message and self-correct rather than crashing the tool call.

```typescript
// Correct pattern — catch and return
export async function handleFoo(args: FooArgs): Promise<FooResult | { error: string }> {
  try {
    // ... implementation
    return result;
  } catch (err) {
    logger.error({ err }, 'handleFoo failed');
    return { error: (err as Error).message };
  }
}

// Wrong — never throw from a handler
export async function handleFoo(args: FooArgs): Promise<FooResult> {
  throw new Error('...');  // ← DO NOT DO THIS
}
```

### 3.3 Safety convention: dryRun default

The `run_pipeline` tool **defaults `dryRun` to `true`**. The implementation enforces this at the code level, not just the schema default:

```typescript
const dryRun = args.dryRun !== false;  // undefined → true; only explicit false triggers live run
```

This ensures an AI hallucinating a `run_pipeline` call without specifying `dryRun: false` will always execute a dry run — no accidental data writes.

---

## 4. Package Structure

```
packages/sluice-mcp/
├── package.json                    ← dependencies, bin entry, scripts
├── tsconfig.json                   ← NodeNext, strict, ESM
└── src/
    ├── index.ts                    ← entry point, stdio transport, SIGINT handler
    ├── server.ts                   ← MCP Server instance, ListTools, CallTool dispatcher
    ├── tools/
    │   └── definitions.ts          ← all 16 Tool schemas (the ListTools payload)
    ├── handlers/
    │   ├── pipeline.ts             ← validate_pipeline, dry_run_pipeline, run_pipeline, get_run_logs
    │   ├── schema.ts               ← inspect_source, list_tables, get_sample_rows, diff_schemas
    │   ├── config.ts               ← read_pipeline_yaml, write_pipeline_yaml, list_pipelines, get_run_state
    │   └── scaffold.ts             ← scaffold_rule, scaffold_transform_plugin, scaffold_adapter, list_plugins
    └── lib/
        ├── fs-utils.ts             ← resolveFile, resolveEnvVars, readRunState
        ├── schema-inspector.ts     ← mssql/pg live schema inspection (dynamic imports)
        └── templates.ts            ← TypeScript skeleton strings for scaffold tools
```

---

## 5. Dependencies

### 5.1 Runtime dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@caracal-lynx/sluice` | `workspace:*` | Core engine — PipelineRunner, schemas, adapters |
| `@modelcontextprotocol/sdk` | `^1.10.0` | MCP Server, stdio transport, request schemas |
| `js-yaml` | `^4.1.0` | Parse/serialize pipeline YAML files |
| `pino` | `^9.5.0` | Structured logging (stderr only) |
| `zod` | `^3.24.1` | Runtime validation of tool arguments |

### 5.2 Dev dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/js-yaml` | `^4.0.9` | Types for js-yaml |
| `@types/node` | `^24.0.0` | Node.js types |
| `pino-pretty` | `^11.3.0` | Human-readable logs in dev |
| `tsx` | `^4.19.0` | Run TypeScript directly in dev |
| `typescript` | `^6.0.0` | Compiler |
| `vitest` | `^2.1.0` | Test runner |

### 5.3 Peer / conditional dependencies

`mssql` and `pg` are **not** listed in `package.json`. They are dynamically imported in `src/lib/schema-inspector.ts` via `await import('mssql')` and `await import('pg')`. The consuming project must have these installed if they use an mssql or pg source. This keeps the MCP package lightweight for csv/xlsx-only clients.

---

## 6. Tool Reference

All 16 tools are defined in `src/tools/definitions.ts` and exported as `ALL_TOOLS`. They are grouped into four categories.

### 6.1 Pipeline Tools

These tools execute the Sluice pipeline engine via `PipelineRunner.fromFile()`.

---

#### `validate_pipeline`

Parse and Zod-validate a pipeline YAML file. Safe — does not connect to any data source.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pipelineFile": {
      "type": "string",
      "description": "Absolute or workspace-relative path to the .pipeline.yaml file."
    }
  },
  "required": ["pipelineFile"],
  "additionalProperties": false
}
```

**Returns on success:**
```json
{
  "valid": true,
  "pipeline": { "name": "customers", "client": "Acme Corp", "entity": "Customer", "version": "1.0.0" }
}
```

**Returns on failure:**
```json
{
  "valid": false,
  "errors": ["source.adapter: Invalid enum value", "transform.fields: Array must contain at least 1 element(s)"]
}
```

**Implementation notes:**
- Read file with `fs.readFile`, parse with `js-yaml`, pass to `PipelineSchema.safeParse()`
- Return `isError: false` even when `valid: false` — a validation failure is a successful tool call that returns useful information, not a tool error

---

#### `dry_run_pipeline`

Execute a pipeline with `dryRun: true`. Uses `:memory:` DuckDB so nothing is written to disk and no target adapter is called. Returns row counts, DQ rejection summary, and any transform errors.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pipelineFile": { "type": "string" },
    "stopOnFirstError": {
      "type": "boolean",
      "description": "Stop at first critical DQ failure. Default false — collect all errors.",
      "default": false
    }
  },
  "required": ["pipelineFile"],
  "additionalProperties": false
}
```

**Returns:** Full `RunResult` object from the engine, or `{ error: string }` on fatal failure.

**Implementation notes:**
- Pass `overrides: { run: { dryRun: true, stagingDb: ':memory:' } }` to `PipelineRunner.fromFile()`
- When `stopOnFirstError: true`, also set `overrides.run.onError = 'stop'`

---

#### `run_pipeline`

Execute a pipeline. **`dryRun` defaults to `true`** — must be explicitly set to `false` for a live run.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pipelineFile": { "type": "string" },
    "dryRun": {
      "type": "boolean",
      "description": "When false, data is written to the target. Defaults TRUE — set explicitly to false for live run.",
      "default": true
    }
  },
  "required": ["pipelineFile"],
  "additionalProperties": false
}
```

**Returns:** Full `RunResult` object, or `{ error: string }`.

**Implementation notes — critical safety rule:**
```typescript
// ALWAYS evaluate dryRun this way — never trust args.dryRun directly
const dryRun = args.dryRun !== false;  // undefined → true; false → false (live run)
```

---

#### `get_run_logs`

Read the run state JSON written by the last pipeline execution.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pipelineFile": { "type": "string" }
  },
  "required": ["pipelineFile"],
  "additionalProperties": false
}
```

**Returns:** The parsed contents of `{run.outputDir}/{pipeline.name}-state.json`, or `{ error: string }` if no state file exists yet.

**State file path resolution:**
```typescript
const outputDir = pipeline.run.outputDir || './output';
const resolvedOutputDir = path.isAbsolute(outputDir)
  ? outputDir
  : path.resolve(path.dirname(pipelineFilePath), outputDir);
const stateFile = path.join(resolvedOutputDir, `${pipeline.pipeline.name}-state.json`);
```

---

### 6.2 Schema Tools

These tools connect to source databases and return structural metadata. Credentials are **always resolved from `process.env`** via the `${ENV_VAR}` token mechanism already used by the Sluice config loader — they are never passed directly by the AI.

---

#### `inspect_source`

Connect to the source defined in a pipeline YAML and return the full column list with types and nullability.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pipelineFile": { "type": "string" }
  },
  "required": ["pipelineFile"],
  "additionalProperties": false
}
```

**Returns on success:**
```json
{
  "adapter": "mssql",
  "columns": [
    { "name": "CustomerID", "type": "int", "nullable": false },
    { "name": "CustomerName", "type": "nvarchar", "nullable": false },
    { "name": "Email", "type": "nvarchar", "nullable": true }
  ]
}
```

**Implementation notes:**
- Load the pipeline YAML → extract `source.adapter` and `source.connection`
- Call `resolveEnvVars(source.connection)` to expand `${...}` tokens
- For `mssql`: run `SELECT TOP 0 <query>` and read column metadata from `result.recordset.columns`
- For `pg`: run `SELECT * FROM (<query>) __m LIMIT 0` and read `result.fields`
- For `csv`, `xlsx`, `rest`: throw an error directing the AI to use `get_sample_rows` or `dry_run_pipeline` instead

---

#### `list_tables`

List all tables and views in a database. Used when setting up a new client to discover available entities.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "adapter": { "type": "string", "enum": ["mssql", "pg"] },
    "connection": {
      "type": "string",
      "description": "Connection string. May contain ${ENV_VAR} tokens."
    },
    "schema": {
      "type": "string",
      "description": "Schema filter (e.g. 'dbo'). Optional."
    }
  },
  "required": ["adapter", "connection"],
  "additionalProperties": false
}
```

**Returns:**
```json
{
  "tables": [
    { "schema": "dbo", "name": "Customers", "type": "TABLE" },
    { "schema": "dbo", "name": "v_ActiveCustomers", "type": "VIEW" }
  ]
}
```

**Implementation notes:**
- mssql: query `INFORMATION_SCHEMA.TABLES` filtered by `TABLE_TYPE IN ('BASE TABLE', 'VIEW')`
- pg: query `information_schema.tables`, exclude `pg_catalog` and `information_schema` schemas
- Dynamic import `mssql`/`pg` — do not static import at module level

---

#### `get_sample_rows`

Fetch a small number of rows from the pipeline source query to understand actual data values.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pipelineFile": { "type": "string" },
    "limit": {
      "type": "number",
      "description": "Max rows to return. Default 10, max 100.",
      "default": 10,
      "minimum": 1,
      "maximum": 100
    }
  },
  "required": ["pipelineFile"],
  "additionalProperties": false
}
```

**Returns:**
```json
{
  "columns": ["CustomerID", "CustomerName", "Email"],
  "rows": [
    { "CustomerID": 1, "CustomerName": "Acme Ltd", "Email": null },
    { "CustomerID": 2, "CustomerName": "Widget Co", "Email": "info@widget.co" }
  ]
}
```

**Implementation notes:**
- Wrap the source query with a limit before executing — do not rely on `LIMIT` in the original query
- For mssql: inject `TOP {limit}` — `SELECT <query>` → `SELECT TOP 10 <rest>`; use regex `replace(/^SELECT\s/i, 'SELECT TOP N ')`
- For pg: wrap — `SELECT * FROM (<query>) __sluice_sample LIMIT N`
- Hard-cap `limit` at 100 regardless of what the AI passes: `Math.min(args.limit ?? 10, 100)`

---

#### `diff_schemas`

Compare source columns against pipeline field mappings. Returns three categorised lists.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pipelineFile": { "type": "string" }
  },
  "required": ["pipelineFile"],
  "additionalProperties": false
}
```

**Returns:**
```json
{
  "mapped": ["CustomerID", "CustomerName"],
  "unmapped": ["LegacyCode", "InternalRef", "CreatedDate"],
  "missing": ["CustomerEmail"]
}
```

Where:
- `mapped` — source columns that have at least one `transform.fields[].from` entry
- `unmapped` — source columns present in the query result but not referenced in any mapping (potential gaps — AI should ask the user whether these are intentionally ignored)
- `missing` — field mappings that reference a source column that does not exist in the query result (will cause runtime errors — must fix before running)

**Implementation notes:**
- All column name comparisons are case-insensitive (use `.toLowerCase()`)
- A field with `from: [col1, col2]` (array) counts both columns as mapped
- Fields with `type: constant` have no `from` — do not count toward mapped/missing

---

### 6.3 Config Tools

These tools read and write pipeline YAML files and associated state. No DB connections required.

---

#### `read_pipeline_yaml`

Read and parse a pipeline YAML file, returning the validated config as a structured object.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pipelineFile": { "type": "string" }
  },
  "required": ["pipelineFile"],
  "additionalProperties": false
}
```

**Returns:** `{ valid: true, pipeline: Pipeline }` or `{ valid: false, raw: object, errors: string[] }`.

**Implementation notes:** Return `valid: false` (not `isError: true`) for invalid YAML — the file may be a draft in progress. Always return the raw parsed object so the AI can see what's there.

---

#### `write_pipeline_yaml`

Write a pipeline YAML string to disk. **Refuses to write invalid configs.**

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pipelineFile": {
      "type": "string",
      "description": "Destination path. Created or overwritten."
    },
    "content": {
      "type": "string",
      "description": "Full YAML content string."
    }
  },
  "required": ["pipelineFile", "content"],
  "additionalProperties": false
}
```

**Returns:** `{ success: true, filePath: string }` or `{ success: false, validationErrors: string[] }`.

**Implementation notes — write sequence:**
1. Parse YAML with `js-yaml.load()` — return validation error if YAML is malformed
2. Run `PipelineSchema.safeParse()` — return Zod errors if schema is invalid
3. Only if both pass: `fs.mkdir(dirname, { recursive: true })` then `fs.writeFile()`

---

#### `list_pipelines`

List all pipeline YAML files in a client folder, with last run state if available.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "clientDir": {
      "type": "string",
      "description": "Path to the client directory (e.g. clients/acme-corp/)."
    }
  },
  "required": ["clientDir"],
  "additionalProperties": false
}
```

**Returns:**
```json
{
  "pipelines": [
    {
      "file": "/path/to/clients/acme-corp/customers.pipeline.yaml",
      "name": "customers",
      "client": "Acme Corp",
      "entity": "Customer",
      "version": "1.0.0",
      "lastRun": {
        "status": "completed",
        "completedAt": "2026-04-20T14:32:00.000Z",
        "rowsExtracted": 1247,
        "rowsLoaded": 1198
      }
    }
  ]
}
```

**Implementation notes:**
- Use `fs.glob('**/*.pipeline.yaml', { cwd: clientDir })` to find files
- For each file: parse pipeline header only for name/client/entity/version — do not run full schema parse unless needed
- Attempt to read the state file for each pipeline; if it doesn't exist, omit `lastRun` from the summary
- Skip files that fail to parse (log a warning, don't throw)

---

#### `get_run_state`

Read the run state JSON for a pipeline. Identical implementation to `get_run_logs` — the two tool names exist to support natural language disambiguation.

**Input schema:** Same as `get_run_logs`.

**Returns:** Parsed state JSON, or `{ error: string }` if no state file exists.

---

### 6.4 Scaffold Tools

These tools generate skeleton TypeScript files. They write to disk and return the file path and generated content so the AI can immediately show the user what was created.

---

#### `scaffold_rule`

Generate a `.rule.ts` Tier-2 DQ rule plugin skeleton.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "outputDir": { "type": "string" },
    "ruleId": {
      "type": "string",
      "description": "camelCase rule ID (e.g. 'ukVatNumber'). Must not clash with built-in IDs.",
      "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$"
    },
    "description": { "type": "string" },
    "severity": {
      "type": "string",
      "enum": ["critical", "warning", "info"],
      "default": "critical"
    }
  },
  "required": ["outputDir", "ruleId"],
  "additionalProperties": false
}
```

**Returns:** `{ file: string, content: string }` — file path and the generated TypeScript.

**Generated file name:** `{ruleId}.rule.ts`

**Generated file structure:**
```typescript
import type { RulePlugin } from '@caracal-lynx/sluice';

const rule: RulePlugin = {
  id: '{ruleId}',
  description: '{description}',
  defaultSeverity: '{severity}',

  validate(value: unknown, _config: Record<string, unknown>): boolean {
    if (value === null || value === undefined) return false;
    const str = String(value).trim();
    // TODO: implement validation logic
    return str.length > 0;
  },
};

export { rule };
```

**Conventions:**
- `validate()` must be synchronous and pure (no async, no I/O)
- Must not mutate any arguments
- Export must be named `rule` (the plugin loader looks for this named export)

---

#### `scaffold_transform_plugin`

Generate a `.transform.ts` Tier-2 transform plugin skeleton.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "outputDir": { "type": "string" },
    "pluginId": {
      "type": "string",
      "description": "camelCase op ID (e.g. 'ifsDateFormat'). Used as customOp in pipeline YAML.",
      "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$"
    },
    "description": { "type": "string" }
  },
  "required": ["outputDir", "pluginId"],
  "additionalProperties": false
}
```

**Returns:** `{ file: string, content: string }`

**Generated file name:** `{pluginId}.transform.ts`

**Generated file structure:**
```typescript
import type { TransformPlugin, FieldMapping } from '@caracal-lynx/sluice';

const transform: TransformPlugin = {
  id: '{pluginId}',
  description: '{description}',

  apply(
    value: unknown,
    _row: Readonly<Record<string, unknown>>,
    _mapping: FieldMapping,
  ): unknown {
    if (value === null || value === undefined) return null;
    // TODO: implement transform logic
    // Access options via _mapping.options?.someKey
    return value;
  },
};

export { transform };
```

**Conventions:**
- `apply()` must be synchronous and pure
- Must NOT mutate the `row` argument (it is `Readonly<>` by convention)
- Export must be named `transform`

---

#### `scaffold_adapter`

Generate a source or target adapter skeleton.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "outputDir": { "type": "string" },
    "adapterName": {
      "type": "string",
      "description": "camelCase name (e.g. 'salesforce'). File: {name}.adapter.ts.",
      "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$"
    },
    "direction": {
      "type": "string",
      "enum": ["source", "target"]
    }
  },
  "required": ["outputDir", "adapterName", "direction"],
  "additionalProperties": false
}
```

**Returns:** `{ file: string, content: string }`

**Generated file name:** `{adapterName}.adapter.ts`

**Source adapter generated structure:**
```typescript
import type { SourceAdapter, SourceConfig, RawRow } from '@caracal-lynx/sluice';

export class {Name}SourceAdapter implements SourceAdapter {
  readonly name = '{adapterName}';
  async connect(config: SourceConfig): Promise<void> { /* TODO */ }
  async *extract(config: SourceConfig): AsyncGenerator<RawRow> { /* TODO */ }
  async disconnect(): Promise<void> { /* TODO */ }
  async describeSchema(config: SourceConfig): Promise<ColumnInfo[]> { return []; }
}
```

**Target adapter generated structure:**
```typescript
import type { TargetAdapter, TargetConfig, TransformedRow } from '@caracal-lynx/sluice';

export class {Name}TargetAdapter implements TargetAdapter {
  readonly name = '{adapterName}';
  async connect(config: TargetConfig): Promise<void> { /* TODO */ }
  async load(rows: TransformedRow[], config: TargetConfig): Promise<number> { return rows.length; }
  async disconnect(): Promise<void> { /* TODO */ }
}
```

**Note:** `describeSchema()` on the source adapter is optional but strongly recommended — it is called by the `inspect_source` MCP tool for non-mssql/pg adapters.

---

#### `list_plugins`

Scan a plugins directory and list discovered rule and transform plugins.

**Input schema:**
```json
{
  "type": "object",
  "properties": {
    "pluginsDir": { "type": "string" }
  },
  "required": ["pluginsDir"],
  "additionalProperties": false
}
```

**Returns:**
```json
{
  "rules": [
    { "id": "ukVatNumber", "type": "rule", "file": "/path/to/ukVatNumber.rule.ts" }
  ],
  "transforms": [
    { "id": "ifsDateFormat", "type": "transform", "file": "/path/to/ifsDateFormat.transform.ts" }
  ]
}
```

**Implementation notes:**
- Scan only the top-level directory — not recursive (plugins are flat by convention)
- Rule files: `*.rule.ts` — ID is the stem before `.rule.ts`
- Transform files: `*.transform.ts` — ID is the stem before `.transform.ts`
- Do not attempt to dynamically import the files — just report what's there

---

## 7. Key Implementation Files

### 7.1 `src/lib/fs-utils.ts`

Three shared utilities used across all handler modules:

```typescript
// Resolves a path — absolute paths pass through, relative resolved from CWD
export function resolveFile(filePath: string): string

// Expands ${ENV_VAR} tokens using process.env — throws if var is not set
export function resolveEnvVars(value: string): string

// Reads {outputDir}/{name}-state.json for a given pipeline YAML path
export async function readRunState(pipelineFilePath: string): Promise<unknown>
```

### 7.2 `src/lib/schema-inspector.ts`

Factory + implementations for live DB schema inspection.

**Interface:**
```typescript
interface SchemaInspector {
  describe(config: SourceConfig): Promise<{ adapter: string; columns: ColumnInfo[] }>;
  listTables(config: { connection: string; schema?: string }): Promise<TableInfo[]>;
  sampleRows(config: SourceConfig & { query: string }): Promise<Record<string, unknown>[]>;
}
```

**Factory:**
```typescript
export function createSourceInspector(adapter: string): SchemaInspector
// 'mssql' → MssqlInspector
// 'pg'    → PgInspector
// other   → UnsupportedInspector (throws helpful error)
```

**Critical:** `mssql` and `pg` must be `await import()`-ed dynamically, not statically imported. This keeps startup fast and avoids errors for clients who don't have these native modules installed.

### 7.3 `src/lib/templates.ts`

Pure functions returning TypeScript skeleton strings:

```typescript
export function ruleTemplate(ruleId: string, description: string, severity: string): string
export function transformPluginTemplate(pluginId: string, description: string): string
export function sourceAdapterTemplate(adapterName: string): string
export function targetAdapterTemplate(adapterName: string): string
```

### 7.4 `src/server.ts`

MCP Server setup and CallTool dispatcher:

```typescript
export function createServer(): Server
```

The dispatcher uses a `switch` statement on `request.params.name`. After calling the handler, it checks if the result has shape `{ error: string }` and sets `isError: true` accordingly. All tool results are JSON-stringified into a single MCP text content block.

### 7.5 `src/index.ts`

Entry point. Configures pino to write to stderr, creates the server, attaches a StdioServerTransport, and registers a SIGINT handler for graceful shutdown.

---

## 8. Server Wiring Pattern

The following code pattern must be followed in `src/server.ts`:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export function createServer(): Server {
  const server = new Server(
    { name: '@caracal-lynx/sluice-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    // ... switch on name, call handler, return content block
  });

  return server;
}
```

In `src/index.ts`:

```typescript
const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## 9. `PipelineRunner.fromFile()` API Requirement

The pipeline handlers call `PipelineRunner.fromFile(filePath, options)`. This static factory must be added to the main Sluice package if it does not already exist.

**Required signature:**

```typescript
// In @caracal-lynx/sluice/src/runner.ts

export interface RunnerOptions {
  overrides?: {
    run?: Partial<RunConfig>;
  };
}

export class PipelineRunner {
  static async fromFile(pipelineFilePath: string, options?: RunnerOptions): Promise<PipelineRunner>;
  async run(): Promise<RunResult>;
}
```

**`RunResult` type** (must be exported from `@caracal-lynx/sluice`):

```typescript
export interface RunResult {
  status: 'completed' | 'failed' | 'partial';
  startedAt: string;       // ISO timestamp
  completedAt: string;     // ISO timestamp
  rowsExtracted: number;
  rowsTransformed: number;
  rowsLoaded: number;
  rowsRejected: number;
  rejectionFile?: string;  // path to rejection CSV, if any rejections
  stateFile: string;       // path to -state.json
  errors: string[];
  dqSummary: {
    totalChecks: number;
    passed: number;
    failed: number;
    critical: number;
    warnings: number;
  };
}
```

---

## 10. Phased Implementation Plan

The MCP server is built in four phases, ordered so that each phase delivers working, testable tools before the next begins.

### Phase 1 — Foundation: Config and Scaffold Tools

**Goal:** Get the package building and delivering immediate value with zero risk. These tools do not connect to databases or execute the engine.

**Deliverables:**

1. Create `packages/sluice-mcp/` directory and add to root workspace
2. `package.json` with all dependencies
3. `tsconfig.json` matching core package conventions
4. `src/lib/fs-utils.ts` — `resolveFile`, `resolveEnvVars`, `readRunState`
5. `src/lib/templates.ts` — all four skeleton string functions
6. `src/tools/definitions.ts` — all 16 tool schemas (placeholders for unimplemented tools is fine)
7. `src/handlers/config.ts` — `read_pipeline_yaml`, `write_pipeline_yaml`, `list_pipelines`, `get_run_state`
8. `src/handlers/scaffold.ts` — `scaffold_rule`, `scaffold_transform_plugin`, `scaffold_adapter`, `list_plugins`
9. `src/server.ts` — dispatcher (Phase 1 tools only; other cases return `{ error: 'not yet implemented' }`)
10. `src/index.ts` — entry point
11. `npm run build` passes with zero errors

**Tests to write (vitest):**
- `write_pipeline_yaml` refuses invalid YAML
- `write_pipeline_yaml` refuses invalid pipeline schema (Zod errors)
- `write_pipeline_yaml` accepts and writes valid pipeline YAML
- `read_pipeline_yaml` returns `valid: false` with errors for an invalid file
- `resolveEnvVars` throws when an ENV var is not set
- `scaffold_rule` creates correct file content
- `scaffold_transform_plugin` creates correct file content
- `scaffold_adapter` creates correct source and target variants
- `list_plugins` scans directory and categorises by extension

**Acceptance criteria:** `npm run build` clean; all Phase 1 tests pass; MCP server starts and responds to `ListTools`.

---

### Phase 2 — Schema Inspection Tools

**Goal:** Connect to source databases and surface structural metadata. Enables the AI to inspect what's actually in a client's MSSQL/PG instance before writing pipelines.

**Deliverables:**

1. `src/lib/schema-inspector.ts` — `MssqlInspector`, `PgInspector`, `UnsupportedInspector`, `createSourceInspector()`
2. `src/handlers/schema.ts` — `inspect_source`, `list_tables`, `get_sample_rows`, `diff_schemas`
3. Wire schema handlers into `src/server.ts` dispatcher
4. Integration tests with a real (or Docker) MSSQL/PG instance (can use vitest's `test.skipIf` to skip when DB not available)

**Key implementation notes:**
- Dynamic import pattern is mandatory: `const sql = await import('mssql')` inside method body
- `mssql` TOP injection regex: `/^SELECT\s/i` → `SELECT TOP {limit} `
- All column name comparisons in `diff_schemas` must be case-insensitive
- `diff_schemas` correctly handles `from: string[]` (array) field mappings
- `inspect_source` for csv/xlsx/rest returns `{ error: 'Schema inspection not supported for {adapter}. Use get_sample_rows or dry_run_pipeline.' }`

**Tests to write:**
- `resolveEnvVars` expands `${DB_SERVER}` correctly
- `diff_schemas` correctly populates `mapped`, `unmapped`, `missing`
- `diff_schemas` handles array `from` fields
- `diff_schemas` ignores `type: constant` fields (no `from`)
- `get_sample_rows` hard-caps limit at 100

**Acceptance criteria:** Schema tools return correct data against a test MSSQL or PG instance; `diff_schemas` unit tests pass against mock column data.

---

### Phase 3 — Pipeline Execution Tools

**Goal:** Wire up the pipeline engine. Enables the AI to validate, dry-run, and (with explicit opt-in) live-run pipelines, then read results.

**Prerequisites:**
- `PipelineRunner.fromFile(filePath, options)` must be implemented and exported from `@caracal-lynx/sluice`
- `RunResult` type must be exported

**Deliverables:**

1. `src/handlers/pipeline.ts` — `validate_pipeline`, `dry_run_pipeline`, `run_pipeline`, `get_run_logs`
2. Wire pipeline handlers into `src/server.ts` dispatcher
3. Integration tests against real pipeline YAML files in `clients/` folder

**Key implementation notes:**
- `validate_pipeline` must return `isError: false` even when `valid: false` — validation failure is useful information, not a tool error
- `dry_run_pipeline` passes `{ run: { dryRun: true, stagingDb: ':memory:' } }` as overrides — the `:memory:` override is critical so dry runs leave no DuckDB files on disk
- `run_pipeline` safety rule: `const dryRun = args.dryRun !== false` — this single line is the safety gate
- Log a `logger.warn` when a live run is initiated (non-dry-run) so there is an audit trail

**Tests to write:**
- `validate_pipeline` returns errors for invalid YAML
- `validate_pipeline` returns `valid: true` for known-good pipeline file
- `dry_run_pipeline` completes without writing any files to `output/`
- `run_pipeline` defaults to dry run when `dryRun` argument is omitted
- `run_pipeline` only writes to target when `dryRun: false` is explicitly passed
- `get_run_logs` returns error object (not throws) when no state file exists

**Acceptance criteria:** All pipeline tool tests pass; manual test confirms live run (`dryRun: false`) correctly writes to target; dry run leaves no artefacts on disk.

---

### Phase 4 — Hardening, Publishing, and Plugin Config

**Goal:** Production-ready package with full test coverage, monorepo wiring, and Claude Desktop integration.

**Deliverables:**

1. `vitest.config.ts` with coverage thresholds (target: 70% line coverage across `src/handlers/`)
2. `npm run typecheck` passes with zero errors and zero `@ts-ignore` suppressions
3. Root `package.json` updated to add `packages/sluice-mcp` as a workspace member
4. `claude_desktop_config.json` example documented (see Section 11)
5. Cowork plugin bundle (`sluice.plugin`) updated to include MCP server reference
6. `README.md` in `packages/sluice-mcp/` documenting: setup, ENV vars required, tool list, safety notes

**Optional — Phase 4 stretch goal:**

Add a `sluice.config.yaml` section for the MCP server to declare which tools are enabled/disabled per client deployment:

```yaml
# sluice.config.yaml
mcp:
  tools:
    run_pipeline:
      enabled: true
      requireConfirmation: true   # AI must include a confirmation message before live run
    list_tables:
      enabled: false              # disable if client doesn't want DB browsing
```

---

## 11. Claude Desktop / Cowork Integration

### 11.1 `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sluice": {
      "command": "npx",
      "args": ["-y", "@caracal-lynx/sluice-mcp"],
      "env": {
        "SLUICE_WORKSPACE": "/path/to/client/engagement/folder",
        "DB_SERVER": "192.168.1.100",
        "DB_NAME": "LegacyERP",
        "DB_USER": "sluice_read",
        "DB_PASS": "hunter2"
      }
    }
  }
}
```

### 11.2 Cowork plugin

The MCP server will be bundled into `sluice.plugin` (the Cowork plugin that also contains the create-sluice-rule, create-sluice-adapter, and create-sluice-plugin skills). The plugin will declare the MCP server as a dependency so it is started automatically when the plugin is activated.

### 11.3 Environment variable resolution

All `${ENV_VAR}` tokens in pipeline YAML connection strings are resolved by `resolveEnvVars()` in `src/lib/fs-utils.ts`. The ENV vars must be set in the MCP server process environment — either via `claude_desktop_config.json` `env` block (above) or via a `.env` file loaded by the client's project.

**The AI never receives credentials.** It passes a pipeline file path; the MCP server reads the connection string from the file and resolves tokens from its own environment.

---

## 12. Security Considerations

| Risk | Mitigation |
|------|------------|
| AI triggers live data write | `dryRun` defaults to `true`; explicit `false` required; `logger.warn` emitted |
| AI reads credentials | Credentials live in ENV vars resolved server-side; never returned to AI |
| AI writes arbitrary files | `write_pipeline_yaml` validates schema before writing; path traversal possible — consider restricting writes to `SLUICE_WORKSPACE` subtree |
| AI drops/truncates target | Sluice has no DDL operations; load-only (INSERT/UPSERT per `onConflict`) |
| Runaway queries via `list_tables` | Read-only queries; no DML; connection closed after each call |
| Large sample rows response | `get_sample_rows` hard-capped at 100 rows |

**Recommended Phase 4 addition:** Validate that `pipelineFile` and `outputDir` arguments resolve to paths within `SLUICE_WORKSPACE` before performing any file operations. Return `{ error: 'Path outside workspace' }` if not.

---

## 13. Known Constraints and Gotchas

1. **`PipelineRunner.fromFile()` may not exist yet.** Check `src/runner.ts` in the main package before implementing Phase 3. Add the static factory method if missing.

2. **`fs.glob` is Node 22+.** The `glob` method on the `fs/promises` module was added in Node 22. Since we target Node 24 LTS, `fs.glob` is available natively — no need for `glob` or `fast-glob` for `list_pipelines`.

3. **mssql column metadata shape.** The `result.recordset.columns` object in the `mssql` package is a `Record<string, IColumn>` where `IColumn` has `type.declaration` (the SQL type name) and `nullable` (boolean). Always check the mssql package version — the shape changed between v9 and v10.

4. **Phase 2 plugin interfaces.** The scaffold templates import `RulePlugin` and `TransformPlugin` from `@caracal-lynx/sluice`. These types must be exported from the main package before Phase 2 of the MCP build begins. They are defined in the Phase 2 plugin system spec (`PHASE2-EXTENSIONS.md`).

5. **`exactOptionalPropertyTypes`** is enabled. This means optional properties must be typed as `T | undefined`, not just `T`. Take care with handler return types — use `?: T` not `: T | undefined` where the property may be absent.

6. **ESM `.js` extensions.** All local imports must use `.js` extension even though the source files are `.ts`. This is the Node ESM + TypeScript NodeNext convention. Example: `import { resolveFile } from '../lib/fs-utils.js'`

7. **No top-level `console` calls.** Even in `src/index.ts`. The startup message must use pino: `logger.info({ version: '0.1.0' }, '@caracal-lynx/sluice-mcp starting')`.
