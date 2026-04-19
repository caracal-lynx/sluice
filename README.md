![Sluice](./sluice-logo.png)

> *"A sluice is a channel that controls the flow of water. Sluice is a toolkit that controls the flow of data. Except data doesn't flood your basement. Usually."*

**`@caracal-lynx/sluice`** — a config-driven ETL toolkit for ERP data migrations, built by [Caracal Lynx Limited](https://caracallynx.com).

[![Node 20](https://img.shields.io/badge/Node-20_LTS-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-private-red)](.)

---

## 🤔 What is this thing?

![Gold Sluice](sluice-for-gold.jpg)

Sluice takes the pain out of ERP data migrations. You know the drill — a client has 20 years of customer records in a legacy SQL database, and they need them in a shiny new ERP system by Monday. The data is a mess, the field names are cryptic, and someone has helpfully stored postcodes in a column called `ADDR5`.

Sluice lets you describe the entire migration as a **YAML pipeline config** — where to get the data, what quality rules to enforce, how to transform the fields, and where to load the result. The engine is written once; every client engagement is just a folder of YAML files.

**No UI. No server. No cloud dependency.** Just the `sluice` CLI, TypeScript modules, and a strong cup of tea. ☕

---

## ✨ What it does

The data flows through four stages — like water through a sluice gate:

```
💾 Source                   🔍 Data Quality              ✨ Transform               🎯 Target
─────────────────    →     ─────────────────    →     ─────────────────    →     ─────────────────
MSSQL / CSV /              Validate rules              Map fields                 Business Central
XLSX / REST /              Reject bad rows             Apply lookups              IFS ERP
PostgreSQL                 Write DQ report             Cleanse values             BlueCherry ERP
                                                       Evaluate expressions       CSV / PostgreSQL
```

Under the bonnet, all extracted data passes through a **local DuckDB staging store** before being transformed and loaded. Think of it as a staging area where data sits while it gets its act together before being presented to the target ERP. 🦆

---

## 🏗️ Architecture

```mermaid
flowchart LR
    A[📄 Pipeline YAML] --> B[⚙️ Config Loader\nZod validation\nENV var resolution]
    B --> C[🔌 Source Adapter\nmssql / pg / csv\nxlsx / rest]
    C --> D[(🦆 DuckDB\nstg_raw)]
    D --> E[🔍 DQ Engine\nRules validation\nRejection report]
    E --> F[✨ Transform Engine\nField mapping\nLookup resolution\nCleanse ops]
    F --> G[(🦆 DuckDB\nstg_transformed)]
    G --> H[🎯 Target Adapter\nbc / ifs / bluecherry\ncsv / pg]
    H --> I[📦 Output\nCSV / REST / DB]
    E -->|❌ critical failures| J[🛑 Pipeline halted\ndq-summary.json\nrejected.csv]
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
```

### CLI flags

| Flag | What it does |
|------|-------------|
| `--log-level debug\|info\|warn\|error` | How chatty do you want the logs? |
| `--env <file>` | Path to your `.env` file (default: `./.env`) |
| `--output <dir>` | Override the output directory |
| `--dry-run` | Extract + DQ + transform, but don't write a single byte to the target |

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

A pipeline has five sections:

```yaml
pipeline:   { name, client, version, entity, description }
source:     { adapter, connection/file/endpoint, ... }
dq:         { rules, stopOnCritical, rejectionFile }
transform:  { lookups, fields }
target:     { adapter, output/baseUrl, ... }
run:        { mode, batchSize, logLevel, dryRun, ... }  # all optional
```

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
| `custom` | Delegate to a plugin (Phase 2) |

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
│   ├── cli.ts              ← CLI entry point (commander)
│   ├── runner.ts           ← PipelineRunner — orchestrates all phases
│   ├── config/             ← Zod schema, YAML loader, ENV var resolution
│   ├── adapters/
│   │   ├── source/         ← mssql, pg, csv, xlsx, rest
│   │   └── target/         ← bc, ifs, bluecherry, csv, pg
│   ├── staging/            ← DuckDB wrapper (stg_raw → stg_transformed)
│   ├── dq/                 ← DQ engine, rules, rejection reporter
│   ├── transform/          ← Transform engine, lookup resolver, cleanse ops
│   └── utils/              ← logger (pino), errors, env helpers
├── tests/
│   ├── fixtures/           ← sample pipeline YAMLs and CSV data
│   ├── unit/               ← unit tests (all I/O mocked)
│   └── integration/        ← real DuckDB :memory: + CSV fixtures
└── clients/                ← 🙈 gitignored — each client has their own repo
    ├── cochran/            ← Cochran Group (Annan) pipelines
    └── eribe/              ← Eribé Knitwear pipelines
```

---

## ⚙️ Environment Variables

Connection strings and credentials live in `.env` (never in YAML files, never in Git).

```bash
# .env
COCHRAN_MSSQL=mssql://user:password@server.cochran.local/LegacyDB
BC_BASE_URL=https://api.businesscentral.dynamics.com/v2.0
BC_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BC_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BC_CLIENT_SECRET=your-secret-here
BC_COMPANY=Cochran Group Ltd
```

Reference them in YAML with `${ENV_VAR}` — resolved at runtime, never stored in config:

```yaml
source:
  adapter: mssql
  connection: ${COCHRAN_MSSQL}
```

---

## 🧩 Phase 2: Extension System

Phase 2 adds a three-tier plugin system so you can extend Sluice without touching the core engine.

### Tier 1 — Composite Rules (YAML) 📋

Name a bundle of checks in a shared rules file and reference them like built-ins:

```yaml
# shared/rules.yaml
rules:
  - id: eribeStyleNo
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
        - { type: eribeStyleNo }   # expands to the three checks above ✨
```

### Tier 2 — Plugin Files (TypeScript) 🔌

Drop a `*.rule.ts` or `*.transform.ts` file into a `plugins/` folder next to your pipeline YAMLs. Auto-discovered at startup:

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

---

## 🤝 Known Clients

| Client | Source | Target | Adapter |
|--------|--------|--------|---------|
| Cochran Group (Annan) | MSSQL legacy DB | IFS ERP | `ifs` |
| Eribé Knitwear | MSSQL / CSV exports | BlueCherry ERP | `bluecherry` |

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
