\# CONTEXT.md

<!-- Sluice project memory — updated 2026-04-28 -->



\## Project summary

Sluice (`@caracal-lynx/sluice`) is a config-driven ETL toolkit for data migrations, built and maintained by Caracal Lynx Limited (Michael Scott). The engine is written once in TypeScript; each client engagement is delivered as a folder of YAML pipeline configs. It replaces one-off migration scripts with a reusable, testable, CLI-driven pipeline that covers extract, data quality, transform, and load — with no UI, no server, and no cloud dependency. Sluice is general-purpose: any data migration from any source to any target. Caracal Lynx's paid adapter packages add ERP-specific connectors (IFS, Business Central, BlueCherry) on top of the open-source core.



\## Key decisions made

\- \*\*Name:\*\* Sluice — tagline \*"Clean data flows through."\*

\- \*\*Package:\*\* `@caracal-lynx/sluice`, binary `sluice`

\- \*\*Language/runtime:\*\* TypeScript 6 (current; Phase 2 complete) → TS 7 Phase 11 (deferred to mid/late 2026 when tsgo emit is stable); Node 24 LTS (current; Phase 1 complete) — Node 26 is Phase 10 (deferred to October 2026 LTS cut) — no Bun, no Deno

\- \*\*Config format:\*\* YAML pipelines validated by Zod v3 at runtime; all TS types inferred via `z.infer<>`

\- \*\*Staging layer:\*\* DuckDB via `@duckdb/node-api` — no Postgres server, no Docker

\- \*\*CLI framework:\*\* `commander` v12

\- \*\*Testing:\*\* Vitest only — Jest explicitly ruled out

\- \*\*Dev execution:\*\* `tsx` — `ts-node` explicitly ruled out

\- \*\*Logging:\*\* `pino` (JSON) + `pino-pretty` in dev — no `console.log` in `src/`

\- \*\*Expression evaluation:\*\* `expr-eval` for safe expressions; `vm.runInNewContext` for `js:` prefix escape hatch — `eval()` and `new Function()` explicitly forbidden

\- \*\*Date handling:\*\* `dayjs` throughout — plugins must import plugins explicitly at call site

\- \*\*No UI, no REST server, no dashboard\*\* — CLI tool only

\- \*\*No multi-tenant SaaS\*\* — consultant toolkit, not a product

\- \*\*Phase 3 plugin system:\*\* three-tier (composite YAML rules → TypeScript plugin files → npm packages); plugins must be synchronous and pure; no I/O in `validate()` or `apply()`; composite rule expansion is one level deep only; duplicate rule IDs throw `ConfigError` — **complete** (Phase 3)

\- \*\*Phase 1 complete and all tests passing\*\* as of 2026-04-17

\- \*\*Open-source decision (April 2026):\*\* Core CLI engine (`@caracal-lynx/sluice`) will be open-sourced under the **Elastic Licence 2.0 (ELv2)**. Country/region rule packages (`etl-rules-uk`, `etl-rules-fashion`), application adapters (IFS, BC, BlueCherry), and the Sluice MCP Server remain **private paid services** from Caracal Lynx. See `SLUICE-IMPLEMENTATION-PLAN.md` for the full phased plan.

\- \*\*Sluice MCP Server:\*\* `@caracal-lynx/sluice-mcp` — a private, paid commercial offering. Provides 16 MCP tools enabling AI-assisted migration (agentic pipeline authoring, live schema inspection, automatic DQ iteration). See `docs/SLUICE-MCP-SPEC.md`.

\- \*\*Implementation sequencing:\*\* ✅ Phase 0 — Governance & Prerequisites: COMPLETE | ✅ Phase 1 — Node v24 + DuckDB Neo upgrade: COMPLETE | ✅ Phase 2 — TypeScript v6 upgrade: COMPLETE | ✅ Phase 3 — Plugin System (three-tier extension model): COMPLETE | 🔵 Phase 4a — Enrich Framework (private `sluice-enrich` repo): IN PROGRESS | 🔵 Phase 4b — Built-in Enrich Providers (VIES, HMRC VAT, UK Trade Tariff): After Phase 4a | 🔴 Phase 5 — Repo Restructure & Open-Source Launch: Blocked by Phase 4a | 🔴 Phase 6 — git/npm Workflow: Blocked by Phase 5 | Full sequence in `SLUICE-IMPLEMENTATION-PLAN.md`



\## Facts \& constraints

\- \*\*Owner:\*\* Michael Scott, Caracal Lynx Limited (SC826823), Gretna, Scotland

\- \*\*Known clients:\*\* Cochran Group (Annan) — IFS ERP (note: Cochran does NOT use Business Central and has no plans to); Eribé Knitwear — BlueCherry ERP

\- \*\*Target platforms:\*\* Windows (PowerShell 7 + Windows Terminal) for dev; `ubuntu-latest` GitHub Actions for CI

\- \*\*Path handling:\*\* always `path.join()` / `path.resolve()` — never string concat

\- \*\*Credentials:\*\* never committed; resolved from `.env` via `${ENV\_VAR}` interpolation before Zod parse

\- \*\*DuckDB path:\*\* `{outputDir}/{pipelineName}.duckdb`; `:memory:` when `dryRun: true`

\- \*\*BC adapter:\*\* OAuth2 client credentials; OData `$batch` max 100 ops; token cached in memory

\- \*\*BlueCherry adapter:\*\* US date format `MM/DD/YYYY`; required columns validated at `connect()` time; `template` CSV overrides column order

\- \*\*IFS adapter:\*\* no header row by default; `columnOrder` array controls column sequence

\- \*\*Coverage target:\*\* 80% line coverage across `src/dq/` and `src/transform/`

\- \*\*npm package namespace:\*\* `@caracal-lynx/` for all published packages



\## Open questions / next steps

\- ✅ **Phase 0:** Governance & prerequisites — complete.

\- ✅ **Phase 1:** Node v24 + DuckDB Neo (`@duckdb/node-api`) upgrade — complete.

\- ✅ **Phase 2:** TypeScript v6 upgrade — complete.

\- ✅ **Phase 3:** Plugin system (three-tier extension model) — complete. See `archive/PHASE2-EXTENSIONS.md`.

\- 🔵 **Phase 4a (NOW):** Enrich Framework — private `caracal-lynx/sluice-enrich` repo; current active work.

\- 🔵 **Phase 4b (after Phase 4a):** Built-in Enrich Providers — VIES, HMRC VAT, UK Trade Tariff.

\- 🔴 **Phase 5 (blocked by Phase 4a):** Repo restructure & open-source launch.

\- 🔴 **Phase 6 (blocked by Phase 5):** git/npm workflow.

\- BlueCherry `REQUIRED\_COLUMNS` names need verification against actual BlueCherry import documentation before live migration.

\- npm package roadmap (`@caracal-lynx/etl-rules-uk`, `@caracal-lynx/etl-rules-fashion`, etc.) not yet scaffolded — deferred until plugin file tier is proven. Note: these will be in a separate **private** `sluice-rules` repo, not the public monorepo.

\- Cochran and Eribé client pipeline configs exist as examples; real `.env` files and lookups not yet in place.



\## Artifacts produced

| File | Purpose | State |

|---|---|---|

| `CLAUDE.md` | Authoritative Phase 1 spec for Claude Code — architecture, YAML spec, Zod schema, adapter notes, build order | Complete |

| `archive/PHASE2-EXTENSIONS.md` | Full spec for three-tier plugin/extension system | Complete |

| `customers.pipeline.yaml` | Cochran Group customer migration example (MSSQL → IFS) | Complete |

| `pipeline.schema.ts` | Canonical Zod schema — seeds `src/config/schema.ts` | Complete |



\## Glossary

| Term | Meaning |

|---|---|

| Sluice | The toolkit itself (`@caracal-lynx/sluice`) |

| Pipeline | A single YAML file describing one entity migration (e.g. customers, styles) |

| Entity | The logical data object being migrated (e.g. `CustomerInfo`, `Style`) |

| DQ | Data quality — the rule-based validation phase |

| `stg\_raw` | DuckDB staging table populated by the source adapter |

| `stg\_transformed` | DuckDB staging table produced by the transform engine |

| Rejection file | CSV written by DQReporter listing rows that failed critical rules |

| Composite rule | A named DQ rule assembled from built-in checks in YAML (Tier 1 extension) |

| Plugin file | A `\*.rule.ts` or `\*.transform.ts` file auto-discovered from a `plugins/` folder (Tier 2) |

| `customOp` | YAML field mapping key that delegates to a registered `TransformPlugin` |

| BC | Business Central (Microsoft ERP) |

| IFS | IFS ERP (target for Cochran Group) |

| BlueCherry | BlueCherry ERP by CGS (target for Eribé Knitwear) |

| Caracal Lynx | Michael's consultancy company — owner of the Sluice toolkit |

