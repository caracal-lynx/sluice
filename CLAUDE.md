@c:/repos/standards/company.md
@c:/repos/standards/programmes/data-gubbins.md
@c:/repos/standards/git/workflow.md

# Sluice — CLAUDE.md

Config-driven ETL toolkit for data migrations. npm: `@caracal-lynx/sluice`.
Owner: Caracal Lynx Limited (SC826823). Last updated: 2026-05-17.

## Sluice in one paragraph

The engine is written once; each client engagement is delivered as a folder of
YAML pipeline configs in a private `sluice-client-<name>` repo. No UI, no server,
no cloud dependency — just the `sluice` CLI plus TypeScript modules importable
by other tools (n8n custom nodes, GitHub Actions). Pipelines extract from
legacy SQL / CSV / Excel / REST sources, validate against configurable DQ
rules, transform via mappings + lookups + expressions, and load to IFS,
Business Central, BlueCherry, or generic CSV/JSON.

*Clean data flows through.*

## Non-negotiables

- No web UI or dashboard
- No streaming / real-time ingestion
- DuckDB is staging only — never a warehouse, never a server
- Single-tenant consultant's toolkit; not a SaaS product
- Must run from Windows PowerShell 7 *and* unattended in GitHub Actions

## Sluice-specific stack

Additions and deviations from the programme baseline in
[data-gubbins.md](c:/repos/standards/programmes/data-gubbins.md) — anything
not listed here follows the programme stack.

| Concern     | Package                          | Notes |
|-------------|----------------------------------|-------|
| SQL Server  | `mssql`                          | Trusted + SQL auth both supported |
| PostgreSQL  | `pg` + `@types/pg`               | |
| CSV         | `csv-parse` + `csv-stringify`    | Streaming |
| Excel       | `exceljs`                        | Read-only. Replaced `xlsx`/SheetJS in 2026-05 to remediate two unpatched HIGH-severity advisories (ReDoS + prototype pollution); SheetJS's maintainer publishes patches only via their CDN tarball, not to npm. |
| HTTP retry  | `axios-retry`                    | 3 retries, exponential backoff |
| Env vars    | `dotenv`                         | Loaded once at CLI entry |

## Invariants

- **`src/staging/store.ts` is the only file that imports `@duckdb/node-api`.**
  All other code goes through the wrapper.
- **Adapter `index.ts` barrels self-register built-ins on import** (both
  `adapters/source/` and `adapters/target/`). Importing the barrel is enough
  to make built-ins available via the registry.
- **Enrich phase implementation lives in private `@caracal-lynx/sluice-enrich@^1.0.0`.**
  This repo only exports the public types in `src/enrich/types.ts`.
- **Prep phase uses a separate lookup cache** (`PrepLookupResolver`) from
  `transform.lookups` — do not share state across phases.
- **Pipeline config schema is Zod** (`src/config/schema.ts`); all TS types are
  inferred from there — never hand-write types that mirror config shapes.
- **`MultiSourcePipelineRunner extends PipelineRunner`** — single-source is the
  base case, multi-source layers merge on top.
- **Expression evaluation is `expr-eval-fork` plus a `js:` VM sandbox** —
  never `eval()`, never `new Function()`. (Fork rationale lives in
  [data-gubbins.md](c:/repos/standards/programmes/data-gubbins.md).)

## Targets

- **IFS** — CSV import via IFS bulk-load utility (`src/adapters/target/ifs.ts`)
- **Business Central** — REST API + OAuth2 client credentials, token managed by
  `BcTokenManager` (`src/adapters/target/bc.ts`)
- **BlueCherry** — CSV import (`src/adapters/target/bluecherry.ts`)
- **Generic** — `csv`, `pg`

## Related docs

- [README.md](c:/repos/sluice/README.md) — install, quick-start, composite rules (Tier 1)
- [PLUGINS.md](c:/repos/sluice/PLUGINS.md) — Tier 2 (file) and Tier 3 (npm) plugin authoring
- [docs/architecture-diagrams.md](c:/repos/sluice/docs/architecture-diagrams.md) — pipeline flow Mermaid diagrams
