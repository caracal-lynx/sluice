# Sluice — CLAUDE.md
# Project specification for Claude Code
# Sluice: config-driven ETL toolkit for ERP data migrations
# npm package: @caracal-lynx/sluice
# Owner: Michael Scott, Caracal Lynx Limited (SC826823)
# Last updated: 2026-04-15

---

## Project overview

**Sluice** is a config-driven ETL toolkit for ERP data migrations, developed and
maintained by Caracal Lynx Limited. The engine is written once; each client
engagement is delivered as a folder of YAML pipeline configs. There is no UI, no
server, and no cloud dependency — just the `sluice` CLI and a set of TypeScript
modules that can be imported by other tools (e.g. n8n custom nodes, GitHub Actions).

*Clean data flows through.*

**Known clients and targets:**

| Client | Source(s) | Target ERP | Adapter |
|---|---|---|---|
| Cochran Group (Annan) | MSSQL legacy DB | IFS ERP | `ifs` |
| Cochran Group (Annan) | MSSQL legacy DB | Business Central | `bc` |
| Eribé Knitwear | MSSQL / CSV exports | BlueCherry ERP | `bluecherry` |

**Primary use cases:**
- Extract data from legacy SQL databases, CSV/Excel exports, and REST APIs
- Validate data quality against a configurable rule set
- Transform field mappings, apply lookups, cleanse values, evaluate expressions
- Load output to BC via REST API, IFS via CSV import, BlueCherry via CSV import,
  or generic CSV/JSON for any other target
- Run from the command line on a developer laptop (Windows, PowerShell 7)
- Run unattended in GitHub Actions CI

**Non-goals:**
- No web UI or dashboard
- No streaming / real-time ingestion
- No data warehouse or lake — DuckDB is used only as a local staging store
- No multi-tenant SaaS — this is a consultant's toolkit, not a product

---

## Repository structure

```
sluice/
├── CLAUDE.md                    ← you are here
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── .env.example
├── .gitignore
│
├── src/
│   ├── index.ts                 ← public API (re-exports from all modules)
│   ├── cli.ts                   ← commander CLI entry point
│   ├── runner.ts                ← PipelineRunner orchestrates all phases
│   │
│   ├── config/
│   │   ├── schema.ts            ← Zod schema (PipelineSchema + sub-schemas)
│   │   ├── loader.ts            ← YAML load + ${ENV_VAR} interpolation + parse
│   │   └── types.ts             ← re-exports of all inferred Zod types
│   │
│   ├── adapters/
│   │   ├── source/
│   │   │   ├── index.ts         ← SourceAdapterRegistry
│   │   │   ├── types.ts         ← SourceAdapter interface
│   │   │   ├── mssql.ts
│   │   │   ├── pg.ts
│   │   │   ├── csv.ts
│   │   │   ├── xlsx.ts
│   │   │   └── rest.ts
│   │   └── target/
│   │       ├── index.ts         ← TargetAdapterRegistry
│   │       ├── types.ts         ← TargetAdapter interface
│   │       ├── bc.ts            ← Business Central REST
│   │       ├── ifs.ts           ← IFS ERP CSV import
│   │       ├── bluecherry.ts    ← BlueCherry ERP CSV import
│   │       ├── csv.ts           ← generic CSV
│   │       └── pg.ts
│   │
│   ├── staging/
│   │   ├── store.ts             ← DuckDB wrapper
│   │   └── schema.ts            ← staging table DDL helpers
│   │
│   ├── dq/
│   │   ├── engine.ts            ← DQEngine
│   │   ├── rules/
│   │   │   ├── index.ts         ← RuleRegistry
│   │   │   ├── types.ts         ← Rule interface + RuleResult
│   │   │   ├── notNull.ts
│   │   │   ├── unique.ts
│   │   │   ├── pattern.ts
│   │   │   ├── email.ts
│   │   │   ├── ukPostcode.ts
│   │   │   ├── maxLength.ts
│   │   │   ├── minMax.ts
│   │   │   └── allowedValues.ts
│   │   └── reporter.ts
│   │
│   ├── transform/
│   │   ├── engine.ts
│   │   ├── lookup.ts
│   │   ├── cleanse.ts
│   │   ├── expression.ts
│   │   └── types.ts
│   │
│   └── utils/
│       ├── logger.ts
│       ├── env.ts
│       └── errors.ts
│
├── tests/
│   ├── fixtures/
│   │   ├── cochran-customers.pipeline.yaml
│   │   ├── eribe-styles.pipeline.yaml
│   │   ├── sample-customers.csv
│   │   └── sample-styles.csv
│   ├── unit/
│   │   ├── config/
│   │   ├── dq/
│   │   ├── transform/
│   │   └── staging/
│   └── integration/
│       ├── csv-to-csv.test.ts
│       └── pipeline-runner.test.ts
│
└── clients/                     ← gitignored in this repo; each client
    ├── cochran/                     gets their own private repo
    │   ├── .env
    │   ├── customers.pipeline.yaml
    │   ├── items.pipeline.yaml
    │   ├── vendors.pipeline.yaml
    │   └── lookups/
    └── eribe/
        ├── .env
        ├── styles.pipeline.yaml
        ├── vendors.pipeline.yaml
        ├── purchase-orders.pipeline.yaml
        └── lookups/
```

---

## Technology stack

| Concern | Package | Notes |
|---|---|---|
| Language | TypeScript 5.x | `strict: true`, `exactOptionalPropertyTypes: true` |
| Runtime | Node.js 20 LTS | No Bun, no Deno — must run in GitHub Actions |
| Config parsing | `js-yaml` | YAML 1.2 only |
| Config validation | `zod` v3 | All config types inferred from Zod |
| SQL Server | `mssql` | Trusted + SQL auth both supported |
| PostgreSQL | `pg` + `@types/pg` | |
| CSV | `csv-parse` + `csv-stringify` | Streaming |
| Excel | `xlsx` (SheetJS) | Read-only |
| HTTP | `axios` + `axios-retry` | 3 retries, exponential backoff |
| Dates | `dayjs` | All date parsing and formatting |
| Staging | `duckdb` (Node binding) | Embedded; no server |
| CLI | `commander` v12 | |
| Logging | `pino` | JSON; `pino-pretty` in dev |
| Testing | `vitest` | No Jest |
| Env vars | `dotenv` | Loaded once at CLI entry |
| Linting | `eslint` + `@typescript-eslint` | |
| Formatting | `prettier` | 2-space, single quotes, trailing commas |
| Expressions | `expr-eval` | Safe expression parser; no eval() |

---

## TypeScript conventions

- **All config types come from Zod inference.** Do not write manual `type` or
  `interface` declarations for anything that maps to pipeline config.
  Use `z.infer<typeof SomeSchema>`.
- **No `any`.** Use `unknown` and narrow explicitly.
- **No `eval()` or `Function()`** anywhere. See expression evaluator section.
- **Async throughout.** All I/O must be `async/await`. No callbacks.
- **Error handling:** throw typed errors from `src/utils/errors.ts`. Never throw
  raw strings. Catch at the `PipelineRunner` boundary.
- **Barrel exports:** each directory has an `index.ts`. Do not import from internal
  files across module boundaries.
- **No circular imports.** Dependency direction:
  `cli` → `runner` → `adapters`, `staging`, `dq`, `transform`, `config`
  Utils are imported by everyone.
- **Path aliases:** `@/` → `src/` in tsconfig.

---

## ═══════════════════════════════════════════════════════════
## YAML PIPELINE CONFIG SPECIFICATION
## ═══════════════════════════════════════════════════════════

Every pipeline is a single YAML file. One file = one migrated entity
(e.g. customers, items, vendors, styles, purchase orders).

### Top-level structure

```yaml
pipeline:   { ... }   # identity and metadata
source:     { ... }   # where to read from
dq:         { ... }   # data quality rules
transform:  { ... }   # field mappings and lookups
target:     { ... }   # where to write to
run:        { ... }   # execution options (all fields optional; all have defaults)
```

---

### `pipeline` section

```yaml
pipeline:
  name: cochran-customers          # REQUIRED. Slug: lowercase, hyphens only.
                                   # Used in output filenames and log messages.
  client: cochran-group            # REQUIRED. Client identifier.
  version: "1.0"                   # REQUIRED. Quote to ensure string type.
  entity: CustomerInfo             # REQUIRED. Logical entity name (used in
                                   # load reports and target adapter metadata).
  description: >                   # Optional. Human-readable description.
    Customer master migration —
    legacy SQL to IFS ERP
```

---

### `source` section

Exactly one of `query`, `file`, or `endpoint` must be present.

```yaml
source:
  adapter: mssql                   # REQUIRED. One of: mssql | pg | csv | xlsx | rest

  # ── SQL adapters (mssql, pg) ──────────────────────────────
  connection: ${COCHRAN_MSSQL}     # Connection string from .env.
                                   # mssql: mssql://user:pass@host/database
                                   # Or a JSON string for trusted/advanced config.
  query: |
    SELECT c.CUST_CODE, c.CUST_NAME, c.POST_CODE
    FROM dbo.Customers c
    WHERE c.Active = 1

  # ── CSV adapter ───────────────────────────────────────────
  file: ./data/customers.csv       # Path or glob (./data/export-*.csv).
  delimiter: ","                   # Default: ","
  encoding: utf-8                  # Default: utf-8

  # ── XLSX adapter ──────────────────────────────────────────
  file: ./data/customers.xlsx
  sheet: "Customer Export"         # Sheet name or 0-based index. Default: 0.

  # ── REST adapter ──────────────────────────────────────────
  endpoint: ${API_BASE}/customers  # Full URL. ${ENV_VAR} resolved at runtime.
  headers:                         # Optional. Added to every request.
    Authorization: Bearer ${API_TOKEN}
    Accept: application/json
  pagination:                      # Optional. Omit for single-page responses.
    type: offset                   # offset | cursor | page
    pageSize: 100
    pageParam: skip                # Query param name for the offset/page value.
    totalField: data.total         # Dot-path to total count in response body.
    dataField: data.items          # Dot-path to the records array.
    cursorField: nextCursor        # For cursor pagination: field in response body.
    cursorParam: cursor            # For cursor pagination: query param name.
```

---

### `dq` section

```yaml
dq:
  stopOnCritical: true             # Default: true. Halt pipeline if any critical rule fails.
  rejectionFile: ./output/cochran-customers-rejected.csv
                                   # Default: ./output/{pipeline.name}-rejected.csv

  rules:
    - field: FIELD_NAME            # Source column name (pre-transform).
      checks:

        # notNull — fails if null, undefined, empty string, or whitespace-only
        - type: notNull
          severity: critical

        # unique — fails if value appears more than once across the full dataset
        - type: unique
          severity: critical

        # pattern — ECMAScript regex, tested with new RegExp(value)
        - type: pattern
          value: "^[A-Z0-9]{3,10}$"
          severity: warning
          message: "Must be 3-10 uppercase alphanumeric characters"
                                   # message is optional; overrides default.

        # email — RFC 5322-ish email validation
        - type: email
          severity: warning

        # ukPostcode — all current UK postcode formats; strips spaces before testing
        - type: ukPostcode
          severity: warning

        # maxLength — maximum string length (integer)
        - type: maxLength
          value: 100
          severity: warning

        # min / max — numeric comparison; coerces value to float
        - type: min
          value: 0
          severity: critical
        - type: max
          value: 500000
          severity: warning

        # allowedValues — case-sensitive array of permitted string values
        - type: allowedValues
          value: [GB, IE, US, DE, FR]
          severity: warning

# Severity:
#   critical  row is rejected; pipeline halts if stopOnCritical: true
#   warning   row is flagged in rejection report but NOT removed from output
#   info      recorded in summary JSON only
```

---

### `transform` section

```yaml
transform:

  # ── Lookup tables ─────────────────────────────────────────
  # Loaded once at start of transform phase, cached in memory.
  lookups:
    - name: currencyMap            # Referenced by field mappings.
      source:                      # Any source adapter works here.
        adapter: csv
        file: ./lookups/currency-codes.csv
      key: legacyCode              # Column to match against source value.
      value: isoCode               # Column to return as resolved value.

    - name: acctMgrMap
      source:
        adapter: mssql
        connection: ${COCHRAN_MSSQL}
        query: "SELECT STAFF_ID as key, IFS_USER_ID as value FROM dbo.Staff"
      key: key
      value: value

  # ── Field mappings ────────────────────────────────────────
  fields:

    # type: string
    - from: CUST_CODE
      to: CustomerNo
      type: string
      max: 20                      # Optional. Truncate after cleanse.

    - from: CUST_NAME
      to: Name
      type: string
      max: 100
      cleanse: trim|titleCase      # Pipe-separated cleanse ops. See table below.

    # type: number — coerce to integer; throws if NaN
    - from: QTY
      to: Quantity
      type: number

    # type: decimal — fixed precision; stored as string in staging
    - from: CREDIT_LIMIT
      to: CreditLimit
      type: decimal
      precision: 2                 # Default: 2

    # type: boolean
    # Truthy: '1','true','yes','y','t' (case-insensitive). All else false.
    - from: IS_ACTIVE
      to: Active
      type: boolean

    # type: date — parse source date, output as dateFormat (default ISO)
    - from: START_DATE
      to: StartDate
      type: date
      format: DD/MM/YYYY           # Optional source parse format (dayjs tokens).

    # type: lookup — resolve via a named lookup table
    - from: CURRENCY
      to: CurrencyCode
      type: lookup
      lookup: currencyMap          # Must match a lookup name above.
      default: GBP                 # Emitted when lookup key not found.
      optional: false              # Default: false. true = null on miss (no error).

    # type: concat — join multiple source fields
    - from: [ADDR1, ADDR2]         # Array of source field names.
      to: Address1
      type: concat
      separator: ", "              # Default: " "
      cleanse: trim|nullIfEmpty

    # type: constant — emit a fixed value regardless of source data
    - to: CustomerGroup
      type: constant
      value: DOMESTIC

    # type: expression — evaluate against source row
    - to: SearchName
      type: expression
      value: "row.CUST_NAME.toUpperCase().substring(0, 20)"
      # For logic beyond expr-eval, prefix with js:
      # value: "js: row.PRICE * (1 - row.DISCOUNT / 100)"

# Common optional field properties:
#   optional: true    null result does not cause a pipeline error
#   default: <val>    fallback value if source is null/empty
#   max: <n>          truncate string to n chars AFTER cleanse
```

#### Cleanse operations reference

Applied left-to-right in the pipe chain. Defined in `src/transform/cleanse.ts`.

| Op | Example input | Example output |
|---|---|---|
| `trim` | `"  hello  "` | `"hello"` |
| `uppercase` | `"hello"` | `"HELLO"` |
| `lowercase` | `"HELLO"` | `"hello"` |
| `titleCase` | `"john smith"` | `"John Smith"` |
| `stripNonAlpha` | `"AB-12!"` | `"AB"` |
| `stripNonNumeric` | `"AB-12!"` | `"12"` |
| `stripWhitespace` | `"h e l l o"` | `"hello"` |
| `padStart:6:0` | `"42"` | `"000042"` |
| `truncate:20` | 21-char string | 20-char string |
| `nullIfEmpty` | `""` | `null` |
| `normaliseQuotes` | `"it\u2019s"` | `"it's"` |
| `normaliseUnicode` | `"caf\u00e9"` | `"cafe"` (NFD→ASCII) |

---

### `target` section

```yaml
target:
  adapter: ifs                     # REQUIRED. One of:
                                   #   bc | ifs | bluecherry | csv | pg | rest

  # ── IFS adapter ───────────────────────────────────────────
  adapter: ifs
  output: ./output/cochran-customers-ifs.csv
  entity: CustomerInfo             # IFS entity name (used in import log).
  includeHeader: false             # Default: false (standard IFS import format).
  columnOrder:                     # Optional. Forces specific column ordering.
    - CustomerNo                   # Must match transform 'to' field names.
    - Name
    - Address1
  dateFormat: YYYY-MM-DD           # Default: YYYY-MM-DD
  delimiter: ","                   # Default: ","
  encoding: utf-8                  # Default: utf-8

  # ── BlueCherry adapter ────────────────────────────────────
  adapter: bluecherry
  entity: Style                    # REQUIRED. One of: Style | Vendor |
                                   # PurchaseOrder | PODetail | Season | ColourSize
  output: ./output/eribe-styles-bc.csv
  template: default                # Optional. 'default' uses built-in required
                                   # columns. Or path to a header-only template CSV
                                   # whose first row defines column order.
  includeHeader: true              # Default: true (BlueCherry expects headers).
  dateFormat: MM/DD/YYYY           # Default: MM/DD/YYYY (BlueCherry is US-origin).
  delimiter: ","
  encoding: utf-8
  nullValue: ""                    # How nulls are rendered. Default: ""

  # ── Business Central REST adapter ─────────────────────────
  adapter: bc
  baseUrl: ${BC_BASE_URL}
  company: ${BC_COMPANY}
  entity: customers                # OData entity name (lowercase, plural).
  apiVersion: v2.0                 # Default: v2.0
  onConflict: fail                 # fail | upsert. Default: fail.
  batchEndpoint: true              # Use OData $batch. Default: true.

  # ── Generic CSV adapter ───────────────────────────────────
  adapter: csv
  output: ./output/data.csv
  includeHeader: true
  delimiter: ","
  encoding: utf-8
  nullValue: ""

  # ── PostgreSQL adapter ────────────────────────────────────
  adapter: pg
  connection: ${TARGET_PG}
  table: customers
  schema: public                   # Default: public
  onConflict: fail                 # fail | upsert | ignore
  upsertKey: [customer_no]         # REQUIRED if onConflict: upsert
```

---

### `run` section

All fields optional. Shown with defaults.

```yaml
run:
  mode: full                       # full | incremental | validate-only
  batchSize: 500                   # Rows per DuckDB insert batch.
  onError: continue                # continue | stop
  logLevel: info                   # debug | info | warn | error
  dryRun: false                    # true: DQ + transform, no output written.
  outputDir: ./output              # Base directory for all output files.
  stagingDb: ""                    # DuckDB path. Default: {outputDir}/{name}.duckdb
                                   # Set ':memory:' to force in-memory mode.
  incrementalField: UPDATED_AT     # Source field for incremental mode.
  incrementalSince: ""             # ISO datetime. If empty, reads from state file.
```

---

### Full example — Cochran customers (MSSQL → IFS)

```yaml
pipeline:
  name: cochran-customers
  client: cochran-group
  version: "1.0"
  entity: CustomerInfo
  description: Customer master — legacy Sage SQL to IFS ERP

source:
  adapter: mssql
  connection: ${COCHRAN_MSSQL}
  query: |
    SELECT
      c.CUST_CODE, c.CUST_NAME, c.ADDR1, c.ADDR2,
      c.POST_CODE, c.COUNTRY, c.EMAIL, c.TEL,
      c.CREDIT_LIMIT, c.CURRENCY, c.ACCT_MGR_ID
    FROM dbo.Customers c
    WHERE c.Active = 1 AND c.DELETED = 0

dq:
  stopOnCritical: true
  rejectionFile: ./output/cochran-customers-rejected.csv
  rules:
    - field: CUST_CODE
      checks:
        - { type: notNull,       severity: critical }
        - { type: unique,        severity: critical }
        - { type: pattern, value: "^[A-Z0-9]{3,10}$", severity: warning }
    - field: CUST_NAME
      checks:
        - { type: notNull,       severity: critical }
        - { type: maxLength, value: 100, severity: warning }
    - field: POST_CODE
      checks:
        - { type: ukPostcode,    severity: warning }
    - field: EMAIL
      checks:
        - { type: email,         severity: warning }
    - field: CREDIT_LIMIT
      checks:
        - { type: min, value: 0, severity: critical }
        - { type: max, value: 500000, severity: warning }
    - field: COUNTRY
      checks:
        - { type: allowedValues, value: [GB, IE, US, DE, FR], severity: warning }

transform:
  lookups:
    - name: currencyMap
      source: { adapter: csv, file: ./lookups/currency-codes.csv }
      key: legacyCode
      value: isoCode
    - name: acctMgrMap
      source:
        adapter: mssql
        connection: ${COCHRAN_MSSQL}
        query: "SELECT STAFF_ID as key, IFS_USER_ID as value FROM dbo.Staff"
      key: key
      value: value
  fields:
    - { from: CUST_CODE,      to: CustomerNo,   type: string,  max: 20 }
    - { from: CUST_NAME,      to: Name,         type: string,  max: 100, cleanse: trim|titleCase }
    - { from: [ADDR1, ADDR2], to: Address1,     type: concat,  separator: ", ", cleanse: trim }
    - { from: POST_CODE,      to: ZipCode,      type: string,  cleanse: trim|uppercase }
    - { from: COUNTRY,        to: Country,      type: string,  default: GB }
    - { from: CURRENCY,       to: CurrencyCode, type: lookup,  lookup: currencyMap, default: GBP }
    - { from: ACCT_MGR_ID,    to: SalesmanCode, type: lookup,  lookup: acctMgrMap,  optional: true }
    - { from: CREDIT_LIMIT,   to: CreditLimit,  type: decimal, precision: 2 }
    - { from: EMAIL,          to: Email,        type: string,  cleanse: trim|lowercase }
    - { to: CustomerGroup,    type: constant,   value: DOMESTIC }
    - { to: SearchName,       type: expression, value: "row.CUST_NAME.toUpperCase().substring(0, 20)" }

target:
  adapter: ifs
  entity: CustomerInfo
  output: ./output/cochran-customers-ifs.csv
  includeHeader: false
  columnOrder: [CustomerNo, Name, Address1, ZipCode, Country, CurrencyCode,
                SalesmanCode, CreditLimit, Email, CustomerGroup, SearchName]

run:
  mode: full
  batchSize: 500
  logLevel: info
  dryRun: false
```

---

### Full example — Eribé styles (CSV → BlueCherry)

```yaml
pipeline:
  name: eribe-styles
  client: eribe-knitwear
  version: "1.0"
  entity: Style
  description: Style master migration from legacy CSV exports to BlueCherry ERP

source:
  adapter: csv
  file: ./data/styles-export.csv
  encoding: utf-8

dq:
  stopOnCritical: true
  rejectionFile: ./output/eribe-styles-rejected.csv
  rules:
    - field: STYLE_NO
      checks:
        - { type: notNull,    severity: critical }
        - { type: unique,     severity: critical }
        - { type: maxLength,  value: 20, severity: warning }
    - field: STYLE_DESC
      checks:
        - { type: notNull,    severity: critical }
        - { type: maxLength,  value: 255, severity: warning }
    - field: DIVISION
      checks:
        - { type: notNull,    severity: critical }
        - { type: allowedValues, value: [WOMENS, MENS, ACCESSORIES], severity: warning }
    - field: SEASON_CODE
      checks:
        - { type: notNull,    severity: warning }
        - { type: pattern, value: "^(SS|AW)[0-9]{2}$", severity: warning }
    - field: COST_PRICE
      checks:
        - { type: min, value: 0,       severity: critical }
        - { type: max, value: 9999.99, severity: warning }
    - field: RETAIL_PRICE
      checks:
        - { type: min, value: 0, severity: critical }

transform:
  lookups:
    - name: divisionMap
      source: { adapter: csv, file: ./lookups/division-codes.csv }
      key: legacyCode
      value: bcCode
    - name: vendorMap
      source: { adapter: csv, file: ./lookups/vendor-codes.csv }
      key: legacyVendorCode
      value: bcVendorNo
  fields:
    - { from: STYLE_NO,      to: StyleNo,       type: string,  max: 20,  cleanse: trim|uppercase }
    - { from: STYLE_DESC,    to: StyleDesc,     type: string,  max: 255, cleanse: trim|normaliseUnicode }
    - { from: DIVISION,      to: Division,      type: lookup,  lookup: divisionMap }
    - { from: SEASON_CODE,   to: Season,        type: string,  max: 10 }
    - { from: VENDOR_CODE,   to: VendorNo,      type: lookup,  lookup: vendorMap, optional: true }
    - { from: COST_PRICE,    to: CostPrice,     type: decimal, precision: 2 }
    - { from: RETAIL_PRICE,  to: RetailPrice,   type: decimal, precision: 2 }
    - { from: WEIGHT_KG,     to: Weight,        type: decimal, precision: 3, default: "0.000" }
    - { from: COUNTRY_ORIG,  to: CountryOrigin, type: string,  default: GB }
    - { from: FIBRE_CONTENT, to: FibreContent,  type: string,  max: 200, cleanse: trim }
    - { to: ActiveFlag,      type: constant,    value: "Y" }
    - { to: CreatedDate,     type: expression,  value: "js: new Date().toLocaleDateString('en-US')" }

target:
  adapter: bluecherry
  entity: Style
  output: ./output/eribe-styles-bc.csv
  includeHeader: true
  dateFormat: MM/DD/YYYY
  nullValue: ""

run:
  mode: full
  batchSize: 200
  logLevel: info
  dryRun: false
```

---

## ═══════════════════════════════════════════════════════════
## ZOD SCHEMA  (src/config/schema.ts)
## ═══════════════════════════════════════════════════════════

Reproduce this schema exactly. Do not invent additional fields or rename enums.

```typescript
import { z } from 'zod';

const Severity   = z.enum(['critical', 'warning', 'info']);
const SourceAd   = z.enum(['mssql', 'pg', 'csv', 'xlsx', 'rest']);
const TargetAd   = z.enum(['bc', 'ifs', 'bluecherry', 'csv', 'pg', 'rest']);
const CleanseOps = z.string().regex(/^[a-zA-Z|:0-9]+$/);

const PaginationSchema = z.object({
  type:        z.enum(['offset', 'cursor', 'page']),
  pageSize:    z.number().int().positive().default(100),
  pageParam:   z.string().optional(),
  totalField:  z.string().optional(),
  dataField:   z.string().optional(),
  cursorField: z.string().optional(),
  cursorParam: z.string().optional(),
});

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
}).refine(s => s.query || s.file || s.endpoint,
  { message: 'source must have query, file, or endpoint' });

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
  stopOnCritical: z.boolean().default(true),
  rejectionFile:  z.string().optional(),
  rules:          z.array(DqRuleSchema).default([]),
});

const LookupSchema = z.object({
  name:   z.string(),
  source: SourceSchema,
  key:    z.string(),
  value:  z.string(),
});

const FieldType = z.enum([
  'string', 'number', 'decimal', 'boolean', 'date',
  'lookup', 'concat', 'constant', 'expression',
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
});

export const TransformSchema = z.object({
  lookups: z.array(LookupSchema).default([]),
  fields:  z.array(FieldMappingSchema).min(1),
});

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
  // BC REST
  baseUrl:       z.string().optional(),
  company:       z.string().optional(),
  apiVersion:    z.string().default('v2.0'),
  onConflict:    z.enum(['fail', 'upsert', 'ignore']).default('fail'),
  upsertKey:     z.array(z.string()).optional(),
  batchEndpoint: z.boolean().default(true),
  // PostgreSQL
  connection:    z.string().optional(),
  table:         z.string().optional(),
  schema:        z.string().default('public'),
});

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

export const PipelineSchema = z.object({
  pipeline: z.object({
    name:        z.string().regex(/^[a-z0-9-]+$/),
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

// Inferred types — use these everywhere; do not write manual interfaces.
export type Pipeline     = z.infer<typeof PipelineSchema>;
export type SourceConfig = z.infer<typeof SourceSchema>;
export type TargetConfig = z.infer<typeof TargetSchema>;
export type RunConfig    = z.infer<typeof RunSchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type DqRule       = z.infer<typeof DqRuleSchema>;
export type Lookup       = z.infer<typeof LookupSchema>;
```

### Phase 2 schema additions (already in `src/config/schema.ts`)

The following are forward-looking additions that extend the canonical schema above.
They are live in the codebase and tested. Do not remove them.

- **`DqSchema.rulesFile`** (`z.string().optional()`) — path to a composite rule
  library YAML file. `ConfigLoader` expands composite rule references into
  built-in check types before Zod validation, so the pipeline runner only sees
  standard checks.
- **`FieldType` includes `'custom'`** — delegates to a `TransformPlugin` via
  `customOp`. Requires `customOp` to be set (enforced by a `.refine()`).
- **`FieldMappingSchema.customOp`** (`z.string().optional()`) — plugin ID for
  `type: custom` fields.
- **`FieldMappingSchema.options`** (`z.record(z.unknown()).optional()`) — arbitrary
  per-plugin config passed through to the transform plugin.
- **`ToolkitConfigSchema`** — schema for `sluice.config.yaml` (toolkit-level
  plugin loading). Not consumed by `PipelineRunner` yet.
- **`CompositeRuleSchema` / `CompositeRuleLibrarySchema`** — schemas for the
  shared rule library YAML files referenced by `dq.rulesFile`.

---

## ═══════════════════════════════════════════════════════════
## PLUGIN INTERFACES
## ═══════════════════════════════════════════════════════════

### SourceAdapter  (src/adapters/source/types.ts)

```typescript
export interface SourceAdapter {
  readonly id: string;
  connect(config: SourceConfig): Promise<void>;
  extract(
    config: SourceConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void
  ): Promise<ExtractResult>;
  disconnect(): Promise<void>;
}

export interface ExtractResult {
  rowsExtracted: number;
  tableName: string;        // always 'stg_raw'
  columns: ColumnMeta[];
}

export interface ColumnMeta {
  name: string;
  duckDbType: string;       // VARCHAR | BIGINT | DOUBLE | BOOLEAN | TIMESTAMP
}
```

### TargetAdapter  (src/adapters/target/types.ts)

```typescript
export interface TargetAdapter {
  readonly id: string;
  connect(config: TargetConfig): Promise<void>;
  load(
    config: TargetConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void
  ): Promise<LoadResult>;
  disconnect(): Promise<void>;
}

export interface LoadResult {
  rowsLoaded: number;
  rowsFailed: number;
  outputPath?: string;      // set for file-based targets
}
```

### DQ Rule  (src/dq/rules/types.ts)

```typescript
export interface Rule {
  readonly id: string;
  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string
  ): RuleViolation | null;
}

export interface RuleViolation {
  field: string;
  rowIndex: number;
  value: unknown;
  rule: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}
```

---

## ═══════════════════════════════════════════════════════════
## ADAPTER IMPLEMENTATION NOTES
## ═══════════════════════════════════════════════════════════

### mssql source

- Stream results: `request.stream = true` + `RecordSet` events.
- SQL Server → DuckDB type map: `varchar/nvarchar/char → VARCHAR`,
  `int/bigint → BIGINT`, `decimal/numeric/money → DOUBLE`,
  `bit → BOOLEAN`, `datetime/date → TIMESTAMP`, `float/real → DOUBLE`.
- Trusted connection: detect `trustedConnection: true` in JSON connection config.

### csv source

- `csv-parse` options: `{ columns: true, skip_empty_lines: true, bom: true }`.
  `bom: true` strips the UTF-8 BOM common in Excel-generated CSVs.
- All columns inferred as `VARCHAR` in DuckDB.
- Support glob patterns: concatenate all matching files into a single staging table.

### xlsx source

- SheetJS: convert to CSV via `xlsx.utils.sheet_to_csv`, then pipe through csv-parse.
- Log a warning if workbook has more than one sheet and `source.sheet` is unset.

### rest source

- `axios-retry`: 3 retries, exponential backoff, retry on 429 and 5xx.
- Flatten nested JSON using `__` separator (`address.postCode` → `address__postCode`).
- All three pagination types must be supported: offset, page, cursor.

### IFS target

- UTF-8 CSV via `csv-stringify`.
- `includeHeader` defaults to `false` for this adapter.
- Apply `target.columnOrder` if specified.
- Format date columns using `dayjs` with `target.dateFormat` (default `YYYY-MM-DD`).

### BlueCherry target  (src/adapters/target/bluecherry.ts)

BlueCherry ERP (CGS — Computer Generated Solutions) uses fixed-format CSV for
bulk import. Each entity type has a required column set. The adapter validates
required columns at `connect()` time, before any data is read.

**Required columns per entity:**

```typescript
const REQUIRED_COLUMNS: Record<string, string[]> = {
  Style: [
    'StyleNo', 'StyleDesc', 'Division', 'Season',
    'CostPrice', 'RetailPrice', 'ActiveFlag',
  ],
  Vendor: [
    'VendorNo', 'VendorName', 'Country', 'CurrencyCode',
  ],
  PurchaseOrder: [
    'PONumber', 'VendorNo', 'Season', 'OrderDate', 'DeliveryDate',
  ],
  PODetail: [
    'PONumber', 'StyleNo', 'ColourCode', 'SizeCode', 'Quantity', 'CostPrice',
  ],
  Season: [
    'SeasonCode', 'SeasonDesc', 'StartDate', 'EndDate',
  ],
  ColourSize: [
    'StyleNo', 'ColourCode', 'ColourDesc', 'SizeCode', 'SizeDesc',
  ],
};
```

**Behaviour:**
- `includeHeader` defaults to `true`.
- Default `dateFormat` is `MM/DD/YYYY` (BlueCherry is US-origin software).
- Any column whose name ends with `Date` (case-insensitive) is automatically
  formatted using `target.dateFormat` via `dayjs`.
- `nullValue` (default `""`) is used for all null/undefined fields.
- At `connect()`:
  1. Verify `target.entity` is in `REQUIRED_COLUMNS`. Throw `ConfigError` if not.
  2. Query `store.columnNames('stg_transformed')` and verify all required columns
     are present. Throw `ConfigError` listing any missing columns.
  3. If `target.template` is a file path, read its header row and use it as the
     definitive column order for the output. If `target.template === 'default'`,
     use the required columns list as column order, with any additional columns
     from `stg_transformed` appended.

**Note on BlueCherry column names:** The column names in `REQUIRED_COLUMNS` are
internal conventions for this toolkit. Verify them against the actual BlueCherry
import documentation before running a live migration. The `template` feature exists
precisely to override these if the client's BlueCherry instance uses different names.

### Business Central REST target

- OAuth2 client credentials: `POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`
- Cache token in memory; refresh 60 seconds before expiry.
- OData `$batch`: `POST {baseUrl}/api/{version}/companies({company})/$batch`
  with `Content-Type: multipart/mixed; boundary=batch_{uuid}`.
  Maximum 100 operations per batch request.
- HTTP 409 with `onConflict: upsert` → issue PATCH to individual entity URL.
- HTTP 4xx (non-409): log error, increment `rowsFailed`, continue if
  `run.onError: continue`.

---

## ═══════════════════════════════════════════════════════════
## PIPELINE RUNNER — EXECUTION ORDER
## ═══════════════════════════════════════════════════════════

**Important:** `ConfigLoader.load()` interpolates `${ENV_VAR}` tokens from
`process.env` but does **not** call `loadEnv()` / `dotenv.config()` itself.
The CLI entry point must call `loadEnv()` before invoking the loader. This keeps
`ConfigLoader` side-effect-free and testable (tests stub `process.env` directly).

```
1.  Load + validate config         ConfigLoader.load(yamlPath)
2.  Resolve output directory       create if not exists
3.  Open DuckDB staging store      StagingStore.open(dbPath)
4.  Connect source adapter
5.  Extract → 'stg_raw'            log: rows extracted
5a. Disconnect source adapter      always in finally
6.  Run DQ rules against 'stg_raw'
    a. Collect all RuleViolations
    b. Write rejection CSV
    c. Write summary JSON
    d. Log DQ summary (info)
    e. If stopOnCritical AND criticalCount > 0 → throw PipelineDQError
7.  Resolve all lookups            LookupResolver.loadAll()
8.  Transform 'stg_raw' → 'stg_transformed'  (batch by batchSize)
9.  If dryRun === true             → STOP (log summary, exit 0)
10. If mode === 'validate-only'    → STOP (log summary, exit 0)
11. Connect target adapter
12. Load 'stg_transformed' → target
12a.Disconnect target adapter      always in finally
13. Close DuckDB staging store     always in finally
14. Write run state file           {outputDir}/{name}-state.json
15. Log final summary (info)
```

**Run state file** `{outputDir}/{name}-state.json`:
```json
{
  "pipeline": "cochran-customers",
  "lastRunAt": "2026-04-15T09:30:00.000Z",
  "lastMode": "full",
  "rowsExtracted": 1842,
  "rowsLoaded": 1801,
  "criticalViolations": 0,
  "warnings": 41,
  "incrementalSince": ""
}
```

Used by `mode: incremental` to auto-determine the `since` timestamp.

---

## ═══════════════════════════════════════════════════════════
## DUCKDB STAGING STORE  (src/staging/store.ts)
## ═══════════════════════════════════════════════════════════

```typescript
class StagingStore {
  constructor(private dbPath: string) {}    // ':memory:' for dryRun/tests

  async open(): Promise<void>
  async close(): Promise<void>
  async createTable(name: string, columns: ColumnMeta[]): Promise<void>
  async insertBatch(table: string, rows: Record<string, unknown>[]): Promise<void>
  async query<T>(sql: string, params?: unknown[]): Promise<T[]>
  async tableExists(name: string): Promise<boolean>
  async dropTable(name: string): Promise<void>
  async rowCount(table: string): Promise<number>
  async columnNames(table: string): Promise<string[]>
  async exportToCsv(
    table: string,
    outputPath: string,
    options?: { delimiter?: string; header?: boolean; encoding?: string }
  ): Promise<void>
}
```

Default DuckDB path: `{outputDir}/{pipelineName}.duckdb`
Use `':memory:'` when `dryRun: true` or `stagingDb: ':memory:'`.

---

## ═══════════════════════════════════════════════════════════
## TRANSFORM ENGINE  (src/transform/engine.ts)
## ═══════════════════════════════════════════════════════════

### Field type behaviours

| type | behaviour |
|---|---|
| `string` | `String(value)`, cleanse ops, then truncate to `max` |
| `number` | `Math.round(Number(value))`. Throw `TransformError` if NaN. |
| `decimal` | `parseFloat(value).toFixed(precision)` stored as string |
| `boolean` | `['1','true','yes','y','t'].includes(String(v).toLowerCase())` |
| `date` | Parse with `dayjs(value, format)`; output as `target.dateFormat` or ISO |
| `lookup` | `LookupResolver.resolve(lookupName, value)` |
| `concat` | Join `from[]` with `separator`, then cleanse |
| `constant` | Emit `value` verbatim |
| `expression` | `ExpressionEvaluator.evaluate(expression, row)` |

### Expression evaluator  (src/transform/expression.ts)

**Must not use `eval()` or `new Function()`.**

1. Expression does NOT start with `js:` → use `expr-eval` Parser.
   Provide `row` as a variable containing all source field values.
2. Expression starts with `js:` → strip prefix, execute via
   `vm.runInNewContext(code, { row, Date, Math, JSON, String, Number, Boolean })`.
   Log a `warn` whenever the `js:` path is taken.

---

## ═══════════════════════════════════════════════════════════
## DQ REPORTER OUTPUT  (src/dq/reporter.ts)
## ═══════════════════════════════════════════════════════════

**Rejection CSV** columns: `row_index`, `field`, `value`, `rule`, `severity`, `message`

**Summary JSON** (`{outputDir}/{name}-dq-summary.json`):
```json
{
  "pipeline": "cochran-customers",
  "runAt": "2026-04-15T09:30:00Z",
  "rowsChecked": 1842,
  "rowsPassed": 1801,
  "rowsRejected": 41,
  "violations": { "critical": 0, "warning": 38, "info": 3 },
  "byField": {
    "POST_CODE": { "critical": 0, "warning": 22 },
    "EMAIL":     { "critical": 0, "warning": 16 }
  }
}
```

---

## ═══════════════════════════════════════════════════════════
## ERROR TYPES  (src/utils/errors.ts)
## ═══════════════════════════════════════════════════════════

```typescript
export class PipelineError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
export class ConfigError     extends PipelineError {}
export class SourceError     extends PipelineError {}
export class StagingError    extends PipelineError {}
export class DQError         extends PipelineError {}
export class PipelineDQError extends DQError {
  constructor(
    public readonly criticalCount: number,
    public readonly reportPath: string,
  ) {
    super(`Pipeline halted: ${criticalCount} critical DQ violations. See ${reportPath}`);
  }
}
export class TransformError  extends PipelineError {}
export class ExpressionError extends TransformError {}
export class LoadError       extends PipelineError {}
```

All error subclasses inherit `this.name = this.constructor.name` from
`PipelineError`, so `err.name` reflects the actual class (e.g. `"ConfigError"`,
`"PipelineDQError"`). `Error.captureStackTrace` (V8-only) trims the constructor
frame from stack traces for cleaner output.

---

## ═══════════════════════════════════════════════════════════
## CLI  (src/cli.ts)
## ═══════════════════════════════════════════════════════════

```
sluice run       <pipeline.yaml>   Full pipeline run
sluice validate  <pipeline.yaml>   DQ + transform only; no load
sluice profile   <pipeline.yaml>   Extract + column profiling; no DQ
sluice check     <pipeline.yaml>   Config validation only; no execution

Global options:
  --log-level <level>   debug | info | warn | error
  --env <file>          Path to .env file  (default: ./.env)
  --output <dir>        Override outputDir
  --dry-run             Force dryRun: true
```

**Exit codes:** `0` success · `1` pipeline error · `2` DQ critical violations · `3` config error

---

## ═══════════════════════════════════════════════════════════
## LOGGING  (src/utils/logger.ts)
## ═══════════════════════════════════════════════════════════

Single `pino` instance. No `console.log` in `src/`.

| Level | Used for |
|---|---|
| `debug` | Per-row progress, SQL queries, lookup cache hits |
| `info` | Phase transitions, row counts, file paths, run summary |
| `warn` | DQ warnings, missing optional lookups, `js:` expression usage |
| `error` | All caught errors before re-throw |

Dev: `npx sluice run pipeline.yaml | npx pino-pretty`

---

## ═══════════════════════════════════════════════════════════
## ENVIRONMENT VARIABLES  (.env.example)
## ═══════════════════════════════════════════════════════════

```bash
# ── Cochran Group — source ────────────────────────────────────
COCHRAN_MSSQL=mssql://user:password@server.cochran.local/LegacyDB

# ── Cochran Group — IFS target ────────────────────────────────
IFS_IMPORT_PATH=C:\IFS\Import

# ── Cochran Group — Business Central ─────────────────────────
BC_BASE_URL=https://api.businesscentral.dynamics.com/v2.0
BC_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BC_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BC_CLIENT_SECRET=your-client-secret
BC_COMPANY=Cochran Group Ltd

# ── Eribé Knitwear — source ───────────────────────────────────
ERIBE_MSSQL=mssql://user:password@server.eribe.local/LegacyDB

# ── Eribé Knitwear — BlueCherry (file-based; no API creds) ───
ERIBE_BC_IMPORT_PATH=C:\BlueCherry\Import

# ── Runtime ───────────────────────────────────────────────────
NODE_ENV=development
LOG_LEVEL=info
```

---

## ═══════════════════════════════════════════════════════════
## TESTING
## ═══════════════════════════════════════════════════════════

- **Vitest only.** No Jest.
- Unit tests: mock all I/O with `vi.mock`.
- Integration tests: real DuckDB (`:memory:`) + CSV fixtures.
- No tests against live SQL Server, BC, IFS, or BlueCherry.
- Target: 80% line coverage across `src/dq/` and `src/transform/`.
- Both full example pipelines in this file must parse cleanly in the config tests.

**Required test cases:**

Config loader: `${ENV_VAR}` resolution · missing var → `ConfigError` ·
invalid YAML → `ZodError` · minimal pipeline with all defaults · both example
pipelines in this spec parse cleanly.

DQ engine: `notNull` on null/empty/whitespace · `unique` with duplicates ·
`ukPostcode` valid and invalid formats · `allowedValues` case sensitivity ·
`stopOnCritical` throws `PipelineDQError` · reporter writes correct CSV and JSON.

Transform engine: `concat` with separator · `lookup` miss + `optional: true` → null ·
`lookup` miss + `optional: false` → `TransformError` · `expression` basic eval ·
`expression` with `js:` prefix · `cleanse: trim|titleCase` · `cleanse: padStart:6:0` ·
`cleanse: normaliseUnicode` · `type: date` with `format: DD/MM/YYYY` ·
`type: boolean` all truthy/falsy variants.

BlueCherry adapter: missing required column → `ConfigError` at `connect()` ·
date columns formatted with `target.dateFormat` · header row present ·
`nullValue` respected · `template` CSV used as column order.

Staging store: insert/query round-trip all DuckDB types · `exportToCsv` delimiter
and header options · `:memory:` mode works correctly.

---

## ═══════════════════════════════════════════════════════════
## BUILD, SCRIPTS, CI
## ═══════════════════════════════════════════════════════════

**package.json scripts:**
```json
{
  "name": "@caracal-lynx/sluice",
  "scripts": {
    "build":      "tsc -p tsconfig.json",
    "dev":        "tsx watch src/cli.ts",
    "lint":       "eslint src tests",
    "format":     "prettier --write src tests",
    "test":       "vitest run",
    "test:watch": "vitest",
    "test:cov":   "vitest run --coverage",
    "sluice":     "tsx src/cli.ts"
  },
  "bin": { "sluice": "dist/cli.js" }
}
```

Use `tsx` (not `ts-node`) for development execution — handles tsconfig path aliases
on Windows without extra configuration.

**GitHub Actions** (`.github/workflows/ci.yml`):
```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm run test:cov
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: coverage/ }
```

---

## ═══════════════════════════════════════════════════════════
## WINDOWS / POWERSHELL NOTES
## ═══════════════════════════════════════════════════════════

- All file paths: `path.join()` / `path.resolve()`. Never string concat with `/`.
- `.env` uses LF line endings (set in `.gitattributes`).
- DuckDB npm package includes the `win32-x64` native binary automatically.
- Do not write Windows-only shell commands in CI (CI runs ubuntu-latest).
- Developer shell: PowerShell 7 on Windows Terminal.

---

## ═══════════════════════════════════════════════════════════
## WHAT NOT TO DO
## ═══════════════════════════════════════════════════════════

- Do not use `ts-node` — use `tsx`.
- Do not use `jest` — use `vitest`.
- Do not use `console.log` in `src/` — use the pino logger.
- Do not write manual TypeScript interfaces for config types — use `z.infer<>`.
- Do not use `eval()` or `new Function()` — use `expr-eval` or `vm.runInNewContext`.
- Do not hard-code connection strings, credentials, or client-specific values.
- Do not import from `duckdb` directly outside `src/staging/store.ts`.
- Do not create `StagingStore` instances outside `PipelineRunner`.
- Do not add UI, REST server, or dashboard code.
- Do not add adapter-specific logic to `PipelineRunner`.
- Do not invent new top-level YAML keys — the schema is fixed.
- Do not add cleanse ops without adding them to the reference table in this file.
- Do not add BlueCherry entity types to `REQUIRED_COLUMNS` without verifying
  column names against actual BlueCherry import documentation first.
- Do not use `dayjs` plugins without importing them explicitly at the call site.

---

## ═══════════════════════════════════════════════════════════
## SUGGESTED BUILD ORDER FOR CLAUDE CODE
## ═══════════════════════════════════════════════════════════

Work phase by phase. Do not start the next phase until the current phase passes
`npm run build` and `npm test` without errors. Ask before proceeding if anything
in this spec is ambiguous.

1. **Scaffold** — `package.json`, `tsconfig.json`, `src/utils/`, `src/config/`.
   Verify both example pipelines parse cleanly.
2. **Staging store** — `src/staging/`. Unit tests with `:memory:`.
3. **Source adapters** — `csv` first, then `mssql`, `pg`, `xlsx`, `rest`.
   Mock all external connections in tests.
4. **DQ engine** — `src/dq/` including all rules and reporter.
5. **Transform engine** — `src/transform/` — all types, cleanse ops, expression eval.
6. **Target adapters** — `csv` → `ifs` → `bluecherry` → `bc` (BC is most complex;
   mock OAuth2 token endpoint in tests).
7. **PipelineRunner** — wire all phases; integration test both fixture pipelines.
8. **CLI** — all four commands and exit codes.
9. **CI** — `.github/workflows/ci.yml`.

---

*This file is the authoritative specification for Sluice. If anything in the
codebase contradicts this file, the codebase is wrong. Update this file whenever
the architecture evolves — then tell Claude Code to re-read it before continuing.*
