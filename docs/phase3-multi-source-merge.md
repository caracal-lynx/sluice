> ⚠️ **OLD PHASE NUMBERING** — This document uses the old phase numbering scheme (Phase 1 = plugin system foundation, Phase 2 = plugins, Phase 3 = multi-source merge). The current master plan uses different phase numbers: Phase 3 = Plugin System (complete), and multi-source merge has no assigned phase number yet. See `SLUICE-IMPLEMENTATION-PLAN.md` for the current sequence.
>
> *The technical content below remains valid as a design reference.*

---

# Sluice Phase 3 — Multi-Source Entity Merge
# Ideas and design notes
# Author: Michael Scott, Caracal Lynx Limited
# Status: Draft / pre-implementation thinking
# Date: 2026-04-17

---

## Problem statement

Some client entities are spread across multiple systems, none of which is
complete on its own. For example:

| Client | Entity | Source 1 | Source 2 | Source 3 |
|---|---|---|---|---|
| Style Co | Product | SQL Server (master codes, costs) |  ERP (suppliers, lead times) | Excel (descriptions, fibre content) |

Each source has authoritative data for some fields and gaps in others.
The current single-source pipeline cannot handle this — we need a way to
declare multiple sources, merge them on a common key, and produce a single
**golden record** for the target.

---

## Core concepts

### Golden record
A single, deduplicated, complete-as-possible record for each entity instance,
assembled from the best available data across all sources.

### Entity key
The field (or compound field) that uniquely identifies an entity across all
sources. For example, `STYLE_NO` for Style Co products. Records are matched
across sources using this key.

### Priority
A numeric rank (1 = highest) assigned to each source. Used by merge
strategies to resolve conflicts when multiple sources have a value for the
same field.

### Merge strategy
The algorithm used to select the winning value per field per row.

---

## Proposed YAML changes

### New: `sources` array (replaces singular `source`)

When multiple sources are needed, replace the single `source:` key with a
`sources:` array. Each source entry has all the fields of the current
`source:` schema plus `id` and `priority`.

```yaml
sources:
  - id: sql-server          # REQUIRED. Slug used in staging table name
                            # and log messages.
    priority: 1             # REQUIRED. 1 = highest priority.
    adapter: mssql
    connection: ${SOURCE_2_MSSQL}
    query: |
      SELECT STYLE_NO, STYLE_DESC, COST_PRICE, RETAIL_PRICE
      FROM dbo.Styles WHERE Active = 1

  - id: 
    priority: 2
    adapter: rest
    endpoint: ${REST_API_BASE}/products
    headers:
      Authorization: Bearer ${REST_API_TOKEN}
    pagination:
      type: offset
      pageSize: 100
      dataField: result
    rename:                        # Optional. Applied immediately after extract,
      name:         STYLE_DESC     # before the merge phase. Maps extracted column
      product_code: STYLE_NO       # names to the canonical names used across all
      cost:         COST_PRICE     # sources. Old name → new name.

  - id: excel
    priority: 3
    adapter: xlsx
    file: ./data/product-data.xlsx
    sheet: "Products"
    rename:
      Style Number: STYLE_NO       # Excel headers with spaces are valid here.
      Description:  STYLE_DESC
      Fibre:        FIBRE_CONTENT
```

Backwards compatible: the existing single `source:` key continues to work.
When `sources:` is present, `source:` must be absent (validated in Zod).

### New: `merge` section

```yaml
merge:
  key: STYLE_NO             # REQUIRED. The entity key field. Must be present
                            # in every source's extract (pre-transform).
                            # For compound keys, use an array:
                            # key: [STYLE_NO, COLOUR_CODE]

  strategy: coalesce        # REQUIRED. See strategies below.

  onUnmatched: include      # What to do with records that appear in only
                            # one source (no match found in other sources).
                            #   include  — include in merged output (default)
                            #   exclude  — drop unmatched records
                            #   warn     — include but log a warning per record
                            #   error    — halt pipeline if any unmatched records

  fieldStrategies:          # Optional. Per-field overrides of the top-level
    - field: CostPrice      # strategy. Takes precedence for that field only.
      strategy: priority-override
    - field: FibreContent
      source: excel         # Always take this field from a named source,
                            # regardless of nulls or priority order.

  conflictLog: ./output/style-co-products-conflicts.csv
                            # Optional. Path for a CSV logging every field
                            # where two non-null values disagreed and the
                            # higher-priority one was chosen. Useful for
                            # post-migration data quality review.

  incrementalSource: sql-server
                            # Optional. Names the source whose
                            # incrementalField drives change detection in
                            # incremental mode. Only that source is
                            # re-extracted using the since timestamp; all
                            # other sources are re-extracted in full and
                            # re-merged. Required when run.mode is
                            # 'incremental'. Ignored in 'full' mode.
```

---

## Merge strategies

### `coalesce` *(recommended default)*

For each field in the output, take the value from the highest-priority
source that has a **non-null, non-empty** value. Falls through to the next
source if the higher-priority source has a null/empty value.

```
field CostPrice:
  sql-server  → 42.50   ← wins (priority 1, non-null)
          → null
  excel       → 40.00

field FibreContent:
  sql-server  → null
          → null
  excel       → "100% Merino"  ← wins (only non-null value)
```

Best for the Style Co scenario: SQL Server is authoritative for prices, 
for supplier data, Excel for descriptions — each fills the gaps of the others.

### `priority-override`

The highest-priority source wins unconditionally, even if its value is null.
Nulls from source 1 override non-null values from source 2 and 3.

Use when source 1 is so authoritative that a deliberate blank should
propagate (e.g. a product discontinued in SQL Server should be blank in
the output even if  still has it).

### `union`

All records from all sources are included. Records that share a key are
merged using `coalesce` for field values. Records unique to a single source
are included as-is. Equivalent to a SQL `FULL OUTER JOIN`.

### `intersect`

Only records that appear in **all** sources are included. Any record missing
from even one source is dropped. Useful when completeness is mandatory.

---

## Column name normalisation (`rename`)

Before the merge phase can assemble a golden record, every source must use
the same column names for the same logical fields. There are two mechanisms:

**SQL and REST sources** — use the query or API field selection to align
names at the point of extraction. This costs nothing extra and keeps the
YAML clean:

```sql
-- sql-server query already uses the canonical column names
SELECT STYLE_NO, STYLE_DESC, COST_PRICE FROM dbo.Styles
```

**CSV and Excel sources** — headers are fixed by whoever created the file.
Use the `rename` map on the source entry to normalise them immediately after
extract, before the merge sees the data:

```yaml
- id: excel
  priority: 3
  adapter: xlsx
  file: ./data/product-data.xlsx
  rename:
    Style Number: STYLE_NO     # old (extracted) → new (canonical)
    Description:  STYLE_DESC
    Fibre:        FIBRE_CONTENT
```

**Rules:**
- `rename` is applied as the last step of the extract phase for that source,
  before per-source DQ rules run — so DQ rules use the canonical names.
- Only the columns listed in `rename` are affected; all other columns pass
  through unchanged.
- If a `rename` key does not exist in the extracted data, log a warning and
  continue — do not throw. The column will simply be absent from the merge.
- There is no `rename` in the post-merge `transform` section. That section
  maps source field names to target field names as today; column name
  alignment across sources is entirely handled here.
- A full per-source `transform` section is deliberately not supported.
  Alignment via SQL aliases, REST field selection, and `rename` covers all
  real-world cases without doubling the schema and runner complexity.

**Implementation:** The rename is executed as a DuckDB `CREATE TABLE AS SELECT`
immediately after `store.insertBatch()` completes for that source, replacing
the raw staging table in place:

```sql
-- Generated by MergeEngine after extracting stg_raw_excel
CREATE OR REPLACE TABLE stg_raw_excel AS
SELECT
  "Style Number" AS STYLE_NO,
  "Description"  AS STYLE_DESC,
  "Fibre"        AS FIBRE_CONTENT,
  *EXCLUDE("Style Number", "Description", "Fibre")
FROM stg_raw_excel;
```

This requires `StagingStore.renameColumns(tableName, renames)` — a Phase 1
prep item (see `docs/phase3-prep-phase1.md`).

---

## Updated pipeline execution flow

```
1.  Load + validate config
2.  Resolve output directory
3.  Open DuckDB staging store
4.  FOR EACH source (in priority order):
    a. Connect source adapter
    b. Extract → stg_raw_{source.id}   e.g. stg_raw_sql_server
    c. Apply rename map (if source.rename is set) → stg_raw_{source.id} in place
    d. Run per-source DQ rules         (optional; see dq.perSource below)
    e. Disconnect source adapter
5.  Merge phase:
    a. Match records across stg_raw_* tables on merge.key
    b. Apply merge strategy per field
    c. Write conflicts to conflictLog (if configured)
    d. Produce stg_merged
6.  Run post-merge DQ rules against stg_merged
    a. Write rejection CSV
    b. Write summary JSON
    c. Halt if stopOnCritical + criticalCount > 0
7.  Resolve lookups
8.  Transform stg_merged → stg_transformed
9.  (dryRun / validate-only checks)
10. Connect target adapter
11. Load stg_transformed → target
12. Disconnect target adapter
13. Close DuckDB staging store
14. Write run state file (one lastRunAt entry per source)
15. Log final summary
```

---

## Run state file (multi-source)

For multi-source pipelines the state file tracks each source independently.
This allows a failed source to be retried without discarding a successful
extract from the others, and gives a clear audit trail of when each system
was last contacted.

`{outputDir}/{name}-state.json`:

```json
{
  "pipeline": "style-co-products-merged",
  "lastRunAt": "2026-04-15T09:30:00.000Z",
  "lastMode": "incremental",
  "rowsMerged": 3104,
  "rowsLoaded": 3089,
  "criticalViolations": 0,
  "warnings": 15,
  "sources": {
    "sql-server": {
      "lastRunAt": "2026-04-15T09:30:00.000Z",
      "rowsExtracted": 2800,
      "incrementalSince": "2026-04-14T00:00:00.000Z"
    },
    "": {
      "lastRunAt": "2026-04-15T09:30:00.000Z",
      "rowsExtracted": 2950,
      "incrementalSince": ""
    },
    "excel": {
      "lastRunAt": "2026-04-15T09:30:00.000Z",
      "rowsExtracted": 1800,
      "incrementalSince": ""
    }
  }
}
```

In `incremental` mode:

- Only the `merge.incrementalSource` uses `incrementalSince` for change
  detection. Its `lastRunAt` from the previous run is used as the next
  run's `incrementalSince` (unless `run.incrementalSince` is set explicitly
  in the YAML).
- All other sources are always extracted in full (their `incrementalSince`
  is always `""`). A partial extract from a non-incremental source would
  corrupt the golden record — the merge cannot fill gaps it doesn't know
  about.

---

## Per-source DQ (optional extension)

DQ rules can be scoped to a specific source using the `sourceId` property.
Rules without `sourceId` are post-merge rules and run against `stg_merged`.

```yaml
dq:
  stopOnCritical: true
  rules:
    # Per-source rule — runs against stg_raw_sql_server only
    - field: STYLE_NO
      sourceId: sql-server
      checks:
        - { type: notNull,  severity: critical }
        - { type: unique,   severity: critical }

    # Per-source rule — runs against stg_raw_excel only
    - field: FIBRE_CONTENT
      sourceId: excel
      checks:
        - { type: maxLength, value: 200, severity: warning }

    # Post-merge rule — runs against stg_merged
    - field: COST_PRICE
      checks:
        - { type: notNull, severity: critical }
        - { type: min,     value: 0, severity: critical }
```

---

## Staging table naming

| Table | Contents |
|---|---|
| `stg_raw_{sourceId}` | Raw extract from one source (e.g. `stg_raw_sql_server`) |
| `stg_merged` | Golden record after merge phase |
| `stg_transformed` | Post-transform output, ready for target |

The merge engine runs DuckDB SQL internally. For `coalesce` strategy, the
generated SQL looks approximately like:

```sql
-- Simplified illustration
SELECT
  COALESCE(s1.STYLE_NO, s2.STYLE_NO, s3.STYLE_NO) AS STYLE_NO,
  COALESCE(s1.COST_PRICE, s2.COST_PRICE, s3.COST_PRICE) AS COST_PRICE,
  COALESCE(s3.FIBRE_CONTENT, s2.FIBRE_CONTENT, s1.FIBRE_CONTENT) AS FIBRE_CONTENT,
  ...
FROM stg_raw_sql_server s1
FULL OUTER JOIN stg_raw_custom    s2 ON s1.STYLE_NO = s2.STYLE_NO
FULL OUTER JOIN stg_raw_excel   s3 ON s1.STYLE_NO = s3.STYLE_NO
```

The merge engine generates this SQL dynamically based on:
- The discovered column set across all sources
- The priority ordering
- Per-field `fieldStrategies` overrides

---

## New Zod schema additions

```typescript
// In schema.ts

const MergeFieldStrategySchema = z.object({
  field:    z.string(),
  strategy: z.enum(['coalesce', 'priority-override']).optional(),
  source:   z.string().optional(),   // named source id
}).refine(s => s.strategy || s.source,
  { message: 'fieldStrategy must have strategy or source' });

export const MergeSchema = z.object({
  key:               z.union([z.string(), z.array(z.string())]),
  strategy:          z.enum(['coalesce', 'priority-override', 'union', 'intersect'])
                       .default('coalesce'),
  onUnmatched:       z.enum(['include', 'exclude', 'warn', 'error']).default('include'),
  fieldStrategies:   z.array(MergeFieldStrategySchema).default([]),
  conflictLog:       z.string().optional(),
  incrementalSource: z.string().optional(),  // source id; required when run.mode = 'incremental'
});

const MultiSourceEntrySchema = SourceSchema.extend({
  id:       z.string().regex(/^[a-z0-9-]+$/),
  priority: z.number().int().positive(),
  rename:   z.record(z.string()).optional(),  // { 'old column': 'new column' }
});

// PipelineSchema updated to accept either source or sources (not both)
export const PipelineSchema = z.object({
  pipeline:  PipelineMetaSchema,
  source:    SourceSchema.optional(),
  sources:   z.array(MultiSourceEntrySchema).min(2).optional(),
  merge:     MergeSchema.optional(),
  dq:        DqSchema,
  transform: TransformSchema,
  target:    TargetSchema,
  run:       RunSchema.default({}),
}).refine(
  s => (s.source && !s.sources && !s.merge) || (!s.source && s.sources && s.merge),
  { message: 'use either source (single) or sources + merge (multi); not both' }
);
```

---

## New source modules

```
src/
├── merge/
│   ├── engine.ts          ← MergeEngine — orchestrates the merge phase
│   ├── sql-builder.ts     ← builds DuckDB FULL OUTER JOIN SQL dynamically
│   ├── conflict-log.ts    ← writes the conflict CSV
│   └── types.ts           ← MergeResult interface
```

```typescript
// src/merge/types.ts

export interface MergeResult {
  rowsMerged:   number;
  conflicts:    number;    // fields where two non-null values disagreed
  unmatched:    number;    // records from only one source
  tableName:    'stg_merged';
}
```

---

## Phase 1 preparation items

These are small changes that should be made during Phase 1 to avoid painful
retrofitting later. None change the observable behaviour of single-source pipelines.

### 1. Parameterise the staging table name

Currently `ExtractResult.tableName` is hardcoded as `'stg_raw'` in the spec.
Change the type to `string` and have the adapter return whatever table name it
was told to write to. `PipelineRunner` passes the table name in for single-source
pipelines (`'stg_raw'`) and in future will pass `'stg_raw_{sourceId}'` per source.

```typescript
// Change in src/adapters/source/types.ts:
export interface ExtractResult {
  rowsExtracted: number;
  tableName:     string;   // was: tableName: 'stg_raw'
  columns:       ColumnMeta[];
}
```

### 2. Make PipelineRunner phases callable as discrete async methods

Instead of one monolithic `run()` method, expose discrete phase methods so that
the multi-source runner can call `extract()` once per source and share the rest:

```typescript
class PipelineRunner {
  async run(config: Pipeline): Promise<RunResult>           // full pipeline
  async extract(config: Pipeline): Promise<ExtractResult>  // phase 4–5 only
  async runDQ(config: Pipeline): Promise<DQSummary>        // phase 6 only
  // etc.
}
```

This also makes unit testing each phase in isolation much cleaner.

### 3. `DqSchema.rules` — add optional `sourceId` field now

Add the `sourceId?: string` field to `DqRuleSchema` in Phase 1 even if the
multi-source runner ignores it. The field will simply be unused in single-source
mode. This avoids a Zod schema breaking change later.

---

## Phase 2 preparation items

### Plugin interface for merge strategies

If Phase 2 introduces a TypeScript plugin file mechanism, include a
`MergeStrategyPlugin` interface alongside `SourceAdapter` and `TargetAdapter`:

```typescript
export interface MergeStrategyPlugin {
  readonly id: string;
  merge(
    store:    StagingStore,
    sources:  Array<{ id: string; priority: number; tableName: string }>,
    config:   MergeConfig,
  ): Promise<MergeResult>;
}
```

This allows clients to implement exotic merge logic (e.g. "take the average
of cost prices from two sources") without changing the core engine.

---

## Full example — Style Co products (SQL Server +  + Excel → BlueCherry)

```yaml
pipeline:
  name: style-co-products-merged
  client: style-co
  version: "1.0"
  entity: Style
  description: >
    Product master golden record assembled from SQL Server (costs),
     (suppliers), and Excel (descriptions, fibre content).

sources:
  - id: sql-server
    priority: 1
    adapter: mssql
    connection: ${SOURCE_2_MSSQL}
    query: |
      SELECT STYLE_NO, STYLE_DESC, DIVISION, SEASON_CODE,
             COST_PRICE, RETAIL_PRICE, COUNTRY_ORIG
      FROM dbo.Styles WHERE Active = 1

  - id: 
    priority: 2
    adapter: rest
    endpoint: ${REST_API_BASE}/api/products
    headers:
      Authorization: Bearer ${REST_API_TOKEN}
    pagination:
      type: offset
      pageSize: 100
      dataField: result
    rename:
      name:         STYLE_DESC    #  field names → canonical source names
      product_code: STYLE_NO
      cost:         COST_PRICE

  - id: excel
    priority: 3
    adapter: xlsx
    file: ./data/product-supplement.xlsx
    sheet: "Products"
    rename:
      Style Number: STYLE_NO      # Excel headers → canonical source names
      Description:  STYLE_DESC
      Fibre:        FIBRE_CONTENT

merge:
  key: STYLE_NO
  strategy: coalesce
  onUnmatched: warn
  incrementalSource: sql-server     # Drives change detection in incremental mode
  fieldStrategies:
    - field: COST_PRICE
      strategy: priority-override   # SQL Server cost price wins even if null
    - field: FIBRE_CONTENT
      source: excel                 # Always from Excel; it's the only source
  conflictLog: ./output/style-co-products-conflicts.csv

dq:
  stopOnCritical: true
  rejectionFile: ./output/style-co-products-rejected.csv
  rules:
    - field: STYLE_NO
      sourceId: sql-server
      checks:
        - { type: notNull,  severity: critical }
        - { type: unique,   severity: critical }
    - field: STYLE_NO          # Post-merge — no sourceId
      checks:
        - { type: notNull,  severity: critical }
        - { type: unique,   severity: critical }
    - field: COST_PRICE
      checks:
        - { type: notNull, severity: critical }
        - { type: min,     value: 0, severity: critical }

transform:
  fields:
    - { from: STYLE_NO,      to: StyleNo,      type: string,  max: 20, cleanse: trim|uppercase }
    - { from: STYLE_DESC,    to: StyleDesc,    type: string,  max: 255, cleanse: trim|normaliseUnicode }
    - { from: DIVISION,      to: Division,     type: string }
    - { from: SEASON_CODE,   to: Season,       type: string,  max: 10 }
    - { from: COST_PRICE,    to: CostPrice,    type: decimal, precision: 2 }
    - { from: RETAIL_PRICE,  to: RetailPrice,  type: decimal, precision: 2 }
    - { from: FIBRE_CONTENT, to: FibreContent, type: string,  max: 200, cleanse: trim }
    - { from: COUNTRY_ORIG,  to: CountryOrigin,type: string,  default: GB }
    - { to: ActiveFlag,      type: constant,   value: "Y" }

target:
  adapter: bluecherry
  entity: Style
  output: ./output/style-co-products-bc.csv
  includeHeader: true

run:
  mode: full
  batchSize: 200
  logLevel: info
  dryRun: false
```

---

## Open questions / decisions needed before implementation

~~1. **Column name conflicts across sources**~~ ✅ **Decided.**
   Each source entry accepts an optional `rename` map (`old: new`) applied
   immediately after extract, before DQ and merge. SQL and REST sources
   normalise column names in the query / field selection; `rename` covers
   CSV and Excel where headers are fixed. No rename capability in
   `fieldStrategies`; no rename in the post-merge `transform` section.
   See "Column name normalisation" section above.

~~2. **Per-source transform**~~ ✅ **Decided.**
   No per-source `transform` sub-section. The combination of SQL `AS`
   aliases, REST field selection, and the `rename` map covers all real-world
   alignment needs without doubling the schema and runner complexity.
   The single post-merge `transform` section maps canonical source field
   names to target field names, exactly as in single-source mode.

~~3. **Incremental mode with multiple sources**~~ ✅ **Decided.**
   `merge.incrementalSource` names the authoritative source for change
   detection. Only that source is extracted incrementally; all others
   are always extracted in full. See `merge` YAML schema and run state
   file section above.

~~4. **State file**~~ ✅ **Decided.**
   The state file tracks `lastRunAt` and `rowsExtracted` per source,
   plus `incrementalSince` for the incremental source. Top-level
   fields retain the pipeline-wide summary. See run state file section above.

~~5. **DuckDB memory**~~ ✅ **Decided.**
   Stick with DuckDB. ERP migration datasets are well within DuckDB's
   columnar engine capabilities (typically < 500k rows). No batching needed
   in the merge engine. If a future client presents a genuinely large dataset,
   revisit at that point.

---

*This document is a design sketch. Nothing here is final until it is
reflected in CLAUDE.md and the corresponding Zod schema.*
