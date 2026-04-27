![Sluice](./images/sluice-logo.png)

> *"A sluice is a channel that controls the flow of water. Sluice is a toolkit that controls the flow of data. Except data doesn't flood your basement. Usually."*

**`@caracal-lynx/sluice`** — a config-driven ETL toolkit for ERP data migrations, built by [Caracal Lynx Limited](https://caracallynx.com).

[![Node 20](https://img.shields.io/badge/Node-20_LTS-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-private-red)](.)

---

## 🤔 What is this thing?

![Gold Sluice](./images/sluice-for-gold.jpg)

Sluice takes the pain out of ERP data migrations. You know the drill — a client has 20 years of customer records in a legacy SQL database, and they need them in a shiny new ERP system by Monday. The data is a mess, the field names are cryptic, and someone has helpfully stored postcodes in a column called `ADDR5`.

Sluice lets you describe the entire migration as a **YAML pipeline config** — where to get the data, what quality rules to enforce, how to transform the fields, and where to load the result. The engine is written once; every client engagement is just a folder of YAML files.

**No UI. No server. No cloud dependency.** Just the `sluice` CLI, TypeScript modules, and a strong cup of tea. ☕

---

## ✨ What it does

The data flows through four stages — like water through a sluice gate:

```
💾 Source(s)                🔍 Data Quality              ✨ Transform               🎯 Target
─────────────────    →     ─────────────────    →     ─────────────────    →     ─────────────────
MSSQL / CSV /              Validate rules              Map fields                 Business Central
XLSX / REST /              Reject bad rows             Apply lookups              IFS ERP
PostgreSQL                 Write DQ report             Cleanse values             BlueCherry ERP
                                                       Evaluate expressions       CSV / PostgreSQL
  (1..N sources)
        ↓
  🔀 Optional Merge
   coalesce, union,
   intersect, priority
```

Under the bonnet, all extracted data passes through a **local DuckDB staging store** before being transformed and loaded. Think of it as a staging area where data sits while it gets its act together before being presented to the target ERP. 🦆

Pipelines can be **single-source** (one YAML per entity, one `source:` block) or **multi-source** — 2+ sources merged on a key column using one of four built-in strategies before DQ and transform run. See [Multi-Source Merge](#-multi-source-merge) below.

---

## 🏗️ Architecture

### Single-source pipeline

```mermaid
flowchart LR
    A[📄 Pipeline YAML] --> B[⚙️ Config Loader\nZod validation\nENV var resolution\nComposite rule expansion]
    B --> C[🔌 Source Adapter\nmssql / pg / csv\nxlsx / rest]
    C --> D[(🦆 DuckDB\nstg_raw)]
    D --> E[🔍 DQ Engine\nRules validation\nRejection report]
    E --> F[✨ Transform Engine\nField mapping\nLookup resolution\nCleanse ops\nCustom plugins]
    F --> G[(🦆 DuckDB\nstg_transformed)]
    G --> H[🎯 Target Adapter\nbc / ifs / bluecherry\ncsv / pg]
    H --> I[📦 Output\nCSV / REST / DB]
    E -->|❌ critical failures| J[🛑 Pipeline halted\ndq-summary.json\nrejected.csv]
```

### Multi-source pipeline

```mermaid
flowchart LR
    A[📄 Pipeline YAML\nsources + merge] --> B[⚙️ Config Loader]
    B --> C1[🔌 Source 1]
    B --> C2[🔌 Source 2]
    B --> C3[🔌 Source N]
    C1 --> D1[(🦆 stg_raw_src1\n+ rename + per-source DQ)]
    C2 --> D2[(🦆 stg_raw_src2\n+ rename + per-source DQ)]
    C3 --> D3[(🦆 stg_raw_srcN\n+ rename + per-source DQ)]
    D1 --> M[🔀 MergeEngine\ncoalesce / union\nintersect / priority-override]
    D2 --> M
    D3 --> M
    M --> G[(🦆 stg_merged\n+ stg_merge_conflicts.csv)]
    G --> E[🔍 Post-merge DQ]
    E --> F[✨ Transform → stg_transformed]
    F --> H[🎯 Target Adapter]
    H --> I[📦 Output]
```

---

## 🧰 Tech Stack

| What | Package | Why |
|------|---------|-----|
| 🔤 Language | TypeScript 5.x `strict` | Because `any` is a cry for help |
| 🟢 Runtime | Node.js 20 LTS | Works in GitHub Actions without drama |
| 📋 Config | `js-yaml` + `zod` | YAML in, typed objects out |
| 🗄️ SQL Server | `mssql` | Because the legacy DB is always SQL Server |
| 📊 Staging | `duckdb` (embedded) | No server needed, surprisingly powerful |
| 📁 CSV | `csv-parse` + `csv-stringify` | Streaming, handles BOM, the works |
| 📈 Excel | `xlsx` (SheetJS) | Read-only — we're migrating away from it, after all |
| 🌐 HTTP | `axios` + `axios-retry` | 3 retries, exponential backoff, rate limit respect |
| 📅 Dates | `dayjs` | Because time zones are already somebody else's problem |
| 🖥️ CLI | `commander` v12 | Clean commands, sane flags |
| 📝 Logging | `pino` | Structured JSON logs — pretty in dev, parseable in CI |
| 🧪 Testing | `vitest` | Not Jest. Never Jest. |
| 🔒 Expressions | `expr-eval` | Safe expression parsing — no `eval()` here, thank you very much |

---

## 🚀 Quick Start

```bash
# Install
npm install @caracal-lynx/sluice

# Check a pipeline config is valid (no data touched)
sluice check customers.pipeline.yaml

# Run DQ and transform but don't write output
sluice validate customers.pipeline.yaml

# Go for it 🚀
sluice run customers.pipeline.yaml

# Profile source data (column stats, no DQ)
sluice profile customers.pipeline.yaml

# Inspect loaded plugins and merge strategies
sluice plugins
sluice merge list-strategies
sluice merge info coalesce
```

### CLI flags

| Flag | What it does |
|------|-------------|
| `--log-level debug\|info\|warn\|error` | How chatty do you want the logs? |
| `--env <file>` | Path to your `.env` file (default: `./.env`) |
| `--output <dir>` | Override the output directory |
| `--plugins <dir...>` | Load additional plugin directories (alongside the pipeline `plugins/` folder) |
| `--dry-run` | Extract + DQ + transform, but don't write a single byte to the target |

When multiple plugin directories resolve to the same absolute path (for example,
`--plugins ./plugins`), Sluice de-duplicates them before loading.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | ✅ All good |
| `1` | ❌ Pipeline error |
| `2` | 🛑 Critical DQ violations halted the pipeline |
| `3` | 📋 Config validation failed |

---

## 📄 Pipeline Config Format

Each migration entity gets its own YAML file. One entity, one file. Nice and tidy.

```
💡 One YAML file = one migrated entity
   (customers, items, vendors, styles, purchase orders, etc.)
```

A single-source pipeline has five sections:

```yaml
pipeline:   { name, client, version, entity, description }
source:     { adapter, connection/file/endpoint, ... }
dq:         { rules, stopOnCritical, rejectionFile }
transform:  { lookups, fields }
target:     { adapter, output/baseUrl, ... }
run:        { mode, batchSize, logLevel, dryRun, ... }  # all optional
```

A multi-source pipeline swaps `source:` for `sources:` + `merge:`:

```yaml
pipeline:   { ... }
sources:    [ { id, priority, adapter, ..., rename? }, ... ]   # 2+ entries
merge:      { key, strategy, onUnmatched, fieldStrategies, conflictLog, incrementalSource? }
dq:         { ... }                 # rules can be scoped via sourceId
transform:  { ... }
target:     { ... }
run:        { ... }
```

`PipelineSchema` requires *either* `source:` (single) *or* both `sources:` + `merge:` (multi) — never both. The CLI auto-routes based on which shape the YAML has, so there's no flag to remember.

### 📥 Source Adapters

| Adapter | Use when... |
|---------|-------------|
| `mssql` | The legacy system is SQL Server (it's always SQL Server) |
| `pg` | The legacy system is PostgreSQL (you lucky thing) |
| `csv` | Someone emailed you a CSV export at 11pm the night before go-live |
| `xlsx` | Same as above but Excel, complete with merged cells and mystery formatting |
| `rest` | The source system has an API! Progress! |

### 🎯 Target Adapters

| Adapter | Loads to... |
|---------|-------------|
| `bc` | Microsoft Dynamics 365 Business Central (via OData REST + OAuth2) |
| `ifs` | IFS ERP (via fixed-format CSV import — no header, specific column order) |
| `bluecherry` | BlueCherry ERP / CGS (CSV import, US-format dates, headers required) |
| `csv` | Generic CSV — for anything else or for manual inspection |
| `pg` | PostgreSQL — useful for intermediate staging or custom targets |

### 🔍 Data Quality Rules

Nine built-in rule types, configurable per field:

```yaml
dq:
  stopOnCritical: true
  rules:
    - field: CUST_CODE
      checks:
        - { type: notNull,       severity: critical }  # 💥 stops the pipeline
        - { type: unique,        severity: critical }
        - { type: pattern,       value: "^[A-Z0-9]{3,10}$", severity: warning }

    - field: EMAIL
      checks:
        - { type: email,         severity: warning }   # ⚠️  flagged but not rejected

    - field: POST_CODE
      checks:
        - { type: ukPostcode,    severity: warning }   # 🇬🇧 all UK formats
```

| Rule | What it checks |
|------|---------------|
| `notNull` | Not null, not empty, not just whitespace |
| `unique` | No duplicates across the whole dataset |
| `pattern` | ECMAScript regex |
| `email` | RFC 5322-ish email validation |
| `ukPostcode` | All current UK postcode formats |
| `maxLength` | String length cap |
| `min` / `max` | Numeric range |
| `allowedValues` | Enum-style allowed value list |

Severity levels: `critical` (row rejected, pipeline can halt) · `warning` (flagged in report, row kept) · `info` (summary only)

### ✨ Transform: Field Mapping Types

| Type | What it does |
|------|-------------|
| `string` | Cast + optional cleanse ops + optional truncation |
| `number` | Integer coercion (NaN = error) |
| `decimal` | Fixed-precision decimal stored as string |
| `boolean` | `'1','true','yes','y','t'` → true. Everything else → false |
| `date` | Parse source date, output in target format |
| `lookup` | Resolve via a CSV or SQL lookup table |
| `concat` | Join multiple source fields with a separator |
| `constant` | Emit a fixed value (e.g. `CustomerGroup: DOMESTIC`) |
| `expression` | Evaluate an expression against the source row |
| `custom` | Delegate to a `TransformPlugin` via `customOp` (Phase 2) |

### 🧹 Cleanse Operations

Pipe-chain them: `cleanse: trim|titleCase|normaliseUnicode`

| Op | Before | After |
|----|--------|-------|
| `trim` | `"  hello  "` | `"hello"` |
| `uppercase` | `"hello"` | `"HELLO"` |
| `lowercase` | `"HELLO"` | `"hello"` |
| `titleCase` | `"john smith"` | `"John Smith"` |
| `stripNonAlpha` | `"AB-12!"` | `"AB"` |
| `stripNonNumeric` | `"AB-12!"` | `"12"` |
| `padStart:6:0` | `"42"` | `"000042"` |
| `nullIfEmpty` | `""` | `null` |
| `normaliseUnicode` | `"café"` | `"cafe"` |
| `normaliseQuotes` | `"it's"` | `"it's"` |

---

## 📁 Repository Structure

```
sluice/
├── src/
│   ├── cli.ts                  ← CLI entry point (commander)
│   ├── runner.ts               ← PipelineRunner — single-source orchestration
│   ├── multi-source-runner.ts  ← MultiSourcePipelineRunner (Phase 3)
│   ├── config/                 ← Zod schema, YAML loader, ENV var + composite expansion
│   ├── adapters/
│   │   ├── source/             ← mssql, pg, csv, xlsx, rest
│   │   └── target/             ← bc, ifs, bluecherry, csv, pg
│   ├── staging/                ← DuckDB wrapper (stg_raw → stg_merged → stg_transformed)
│   ├── dq/                     ← DQ engine, rules, rejection reporter
│   ├── transform/              ← Transform engine, lookup resolver, cleanse ops
│   ├── merge/                  ← MergeEngine, SQL builder, 4 built-in strategies
│   ├── plugins/                ← Rule/Transform/Merge registries + file & npm loaders
│   └── utils/                  ← logger (pino), errors, env helpers
├── tests/
│   ├── fixtures/               ← sample pipeline YAMLs, CSV/rules data, plugin files
│   ├── unit/                   ← unit tests (all I/O mocked)
│   └── integration/            ← real DuckDB :memory: + CSV fixtures
└── clients/                    ← 🙈 gitignored — each client has their own repo
    ├── acme-corp/                ← Acme Corp pipelines
    └── style-co/                  ← Style Co pipelines
```

---

## ⚙️ Environment Variables

Connection strings and credentials live in `.env` (never in YAML files, never in Git).

```bash
# .env
SOURCE_MSSQL=mssql://user:password@serverlegacy.example.local/LegacyDB
BC_BASE_URL=https://api.businesscentral.dynamics.com/v2.0
BC_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BC_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BC_CLIENT_SECRET=your-secret-here
BC_COMPANY=Example Company Ltd
```

Reference them in YAML with `${ENV_VAR}` — resolved at runtime, never stored in config:

```yaml
source:
  adapter: mssql
  connection: ${SOURCE_MSSQL}
```

---

## 🧩 Phase 2: Extension System

Phase 2 adds a three-tier plugin system so you can extend Sluice without touching the core engine.

### Tier 1 — Composite Rules (YAML) 📋

Name a bundle of checks in a shared rules file and reference them like built-ins:

```yaml
# shared/rules.yaml
rules:
  - id: style-coStyleNo
    checks:
      - { type: notNull,   severity: critical }
      - { type: pattern,   value: "^[A-Z]{2}[0-9]{4}$", severity: critical }
      - { type: maxLength, value: 6, severity: critical }
```

```yaml
# In your pipeline:
dq:
  rulesFile: ../../shared/rules.yaml
  rules:
    - field: STYLE_NO
      checks:
        - { type: style-coStyleNo }   # expands to the three checks above ✨
```

### Tier 2 — Plugin Files (TypeScript) 🔌

Drop a `*.rule.ts`, `*.transform.ts`, or `*.merge.ts` file into a `plugins/` folder next to your pipeline YAMLs. Auto-discovered at startup:

```typescript
// plugins/ukVatNumber.rule.ts
export const rule: RulePlugin = {
  id: 'ukVatNumber',
  validate(value, config, rowIndex, field) {
    const valid = /^GB([0-9]{9}|[0-9]{12}|(GD|HA)[0-9]{3})$/.test(String(value));
    return valid ? null : { field, rowIndex, value, rule: 'ukVatNumber',
      severity: config.severity, message: 'Invalid UK VAT number' };
  }
};
```

### Tier 3 — npm Packages 📦

When plugins are useful across multiple clients, promote them to scoped npm packages and declare them in `sluice.config.yaml`:

```yaml
# sluice.config.yaml
plugins:
  - package: "@caracal-lynx/etl-rules-uk"
  - package: "@caracal-lynx/etl-rules-fashion"
  - package: "@caracal-lynx/etl-transform-ifs"
```

All three tiers use the same registry interfaces and are invoked identically by the engines. The engine doesn't know or care which tier a rule came from. 🤷

### List Loaded Plugins

```bash
sluice plugins

# Include extra plugin directories outside the pipeline folder
sluice plugins --plugins ./shared/plugins ./team/plugins
```

Output:
```
📋 Data Quality Rules:
  • ukVatNumber
  • bcAccountCode
  • iso8601Date

🔄 Transform Operations:
  • slugGenerator
  • normalizeCompanyName
  • fixedDecimal

🔀 Merge Strategies:
  • coalesce
  • priority-override
  • union
  • intersect
```

### Getting Started with Plugins

Detailed guide: **[PLUGINS.md](./PLUGINS.md)**

- Create a custom DQ rule
- Create a custom transform operation
- Create a custom merge strategy
- Package plugins as npm packages
- Test and debug plugins
- Real-world examples

---

## 🔀 Multi-Source Merge

Phase 3 lets a single pipeline extract from **2+ sources** and merge them on a key column before DQ and transform. Useful when the master record for an entity is scattered across systems — master data in SQL Server, pricing enrichment in an Excel sheet, product descriptions in , and so on.

### Built-in merge strategies

| Strategy | Behaviour | When to use |
|---|---|---|
| `coalesce` | First non-null value wins (priority-ordered; whitespace treated as blank) | Enriching a primary source with fallback data from lower-priority sources |
| `priority-override` | Highest-priority source wins, even if null or blank | Strict priority — the trusted source is the trusted source, full stop |
| `union` | All rows from all sources, deduplicated by key | Combining independent datasets (e.g. multi-warehouse inventory) |
| `intersect` | Only rows present in **all** sources | Reconciliation / "find the records that agree" |

Custom strategies can be dropped in as `*.merge.ts` plugins or shipped as npm packages — same three-tier model as DQ rules and transforms.

### A minimal multi-source pipeline

```yaml
pipeline:
  name: style-co-products-merged
  client: style-co
  version: "1.0"
  entity: Style

sources:
  - id: sql-server              # staging table: stg_raw_sql-server
    priority: 1                 # lower = higher precedence
    adapter: mssql
    connection: ${SOURCE_2_MSSQL}
    query: "SELECT STYLE_NO, STYLE_DESC, COST_PRICE FROM dbo.Styles WHERE Active = 1"

  - id: excel
    priority: 2
    adapter: xlsx
    file: ./data/product-data.xlsx
    sheet: "Products"
    rename:                     # applied in-place after extract, before DQ
      Style Number: STYLE_NO
      Description: STYLE_DESC
      Fibre: FIBRE_CONTENT

merge:
  key: STYLE_NO                 # single column or array for composite keys
  strategy: coalesce
  onUnmatched: include          # include | exclude | warn | error
  fieldStrategies:              # per-field overrides
    - { field: FIBRE_CONTENT, source: excel }          # pin to one source
    - { field: COST_PRICE,    strategy: priority-override }
  conflictLog: ./output/style-co-products-conflicts.csv   # optional CSV of field disagreements

dq:
  stopOnCritical: true
  rules:
    - field: STYLE_NO           # 🎯 pre-merge: scoped to one source
      sourceId: sql-server
      checks: [ { type: notNull, severity: critical }, { type: unique, severity: critical } ]
    - field: STYLE_DESC         # 🎯 post-merge: runs against stg_merged
      checks: [ { type: notNull, severity: critical } ]

transform: { ... }
target:    { ... }
```

Pre-merge rules (`sourceId: …`) run against each source's staging table before merging and generate per-source rejection CSVs (suffixed `-{sourceId}`). Post-merge rules (no `sourceId`) run once against `stg_merged`.

### Incremental multi-source

```yaml
merge:
  incrementalSource: sql-server   # must match a source id; required in incremental mode
run:
  mode: incremental
  incrementalField: UPDATED_AT
```

Only the named source is filtered by timestamp; other sources run full each time. The state file gains a per-source `sources` block tracking each source's last run time.

### Inspect merge strategies

```bash
sluice merge list-strategies        # ids + descriptions for all registered strategies
sluice merge info coalesce          # details for one strategy
```

A full working example lives at [tests/fixtures/style-co-products-merged.pipeline.yaml](tests/fixtures/style-co-products-merged.pipeline.yaml).

---

## 🤝 Known Clients

| Client | Source | Target | Adapter |
|--------|--------|--------|---------|
| Acme Corp | MSSQL legacy DB | IFS ERP | `ifs` |
| Style Co | MSSQL / CSV exports | BlueCherry ERP | `bluecherry` |

---

## 🧪 Testing

```bash
npm test           # run tests once
npm run test:watch # watch mode (great for TDD)
npm run test:cov   # with coverage report
```

- **Unit tests** mock all I/O with `vi.mock` — no live databases required
- **Integration tests** use real DuckDB (`:memory:`) with CSV fixtures
- Target: 80% line coverage across `src/dq/` and `src/transform/`
- CI runs on `ubuntu-latest` via GitHub Actions

---

## 🏗️ Development

```bash
npm run build      # tsc compile
npm run dev        # tsx watch src/cli.ts (live reload)
npm run lint       # eslint
npm run format     # prettier

# Pretty logs in dev:
npm run dev -- run customers.pipeline.yaml | npx pino-pretty
```

> **Note:** Uses `tsx`, not `ts-node`. Path aliases work correctly on Windows without extra configuration. 🪟

---

## 🚫 Things Sluice Is Not

- ❌ A web application or dashboard (there's no UI — this is a good thing)
- ❌ A streaming / real-time ingestion platform
- ❌ A data warehouse
- ❌ A multi-tenant SaaS product
- ❌ An excuse to use `eval()` anywhere

---

## 📦 Package Info

```
npm package:  @caracal-lynx/sluice
owner:        Caracal Lynx Limited (SC826823)
author:       Michael Scott
maintainers:  Michael Scott, Carolyn Scott, Andrew Scott, Duncan Scott
```

---

*Clean data flows through.* 💧
