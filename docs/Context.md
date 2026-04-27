\# CONTEXT.md

<!-- Sluice project memory — updated 2026-04-17 -->



\## Project summary

Sluice (`@caracal-lynx/sluice`) is a config-driven ETL toolkit for ERP data migrations, built and maintained by Caracal Lynx Limited (Michael Scott). The engine is written once in TypeScript; each client engagement is delivered as a folder of YAML pipeline configs. It replaces one-off migration scripts with a reusable, testable, CLI-driven pipeline that covers extract, data quality, transform, and load — with no UI, no server, and no cloud dependency.



\## Key decisions made

\- \*\*Name:\*\* Sluice — tagline \*"Clean data flows through."\*

\- \*\*Package:\*\* `@caracal-lynx/sluice`, binary `sluice`

\- \*\*Language/runtime:\*\* TypeScript 5.x strict, Node.js 20 LTS — no Bun, no Deno

\- \*\*Config format:\*\* YAML pipelines validated by Zod v3 at runtime; all TS types inferred via `z.infer<>`

\- \*\*Staging layer:\*\* DuckDB (embedded Node binding) — no Postgres server, no Docker

\- \*\*CLI framework:\*\* `commander` v12

\- \*\*Testing:\*\* Vitest only — Jest explicitly ruled out

\- \*\*Dev execution:\*\* `tsx` — `ts-node` explicitly ruled out

\- \*\*Logging:\*\* `pino` (JSON) + `pino-pretty` in dev — no `console.log` in `src/`

\- \*\*Expression evaluation:\*\* `expr-eval` for safe expressions; `vm.runInNewContext` for `js:` prefix escape hatch — `eval()` and `new Function()` explicitly forbidden

\- \*\*Date handling:\*\* `dayjs` throughout — plugins must import plugins explicitly at call site

\- \*\*No UI, no REST server, no dashboard\*\* — CLI tool only

\- \*\*No multi-tenant SaaS\*\* — consultant toolkit, not a product

\- \*\*Phase 2 plugin system:\*\* three-tier (composite YAML rules → TypeScript plugin files → npm packages); plugins must be synchronous and pure; no I/O in `validate()` or `apply()`; composite rule expansion is one level deep only; duplicate rule IDs throw `ConfigError`

\- \*\*Phase 1 complete and all tests passing\*\* as of 2026-04-17



\## Facts \& constraints

\- \*\*Owner:\*\* Michael Scott, Caracal Lynx Limited (SC826823), Gretna, Scotland

\- \*\*Known clients:\*\* Acme Corp — IFS ERP + Business Central; Style Co — BlueCherry ERP

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

\- Phase 2 implementation not yet started — begin with `src/plugins/registry.ts` + `src/plugins/types.ts`

\- BlueCherry `REQUIRED\_COLUMNS` names need verification against actual BlueCherry import documentation before live migration

\- npm package roadmap (`@caracal-lynx/etl-rules-uk`, `@caracal-lynx/etl-rules-fashion`, etc.) not yet scaffolded — deferred until plugin file tier is proven in production

\- Acme Corp and Style Co client pipeline configs exist as examples; real `.env` files and lookups not yet in place



\## Artifacts produced

| File | Purpose | State |

|---|---|---|

| `CLAUDE.md` | Authoritative Phase 1 spec for Claude Code — architecture, YAML spec, Zod schema, adapter notes, build order | Complete |

| `PHASE2-EXTENSIONS.md` | Full spec for three-tier plugin/extension system | Complete |

| `customers.pipeline.yaml` | Acme Corp customer migration example (MSSQL → IFS) | Complete |

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

| IFS | IFS ERP (target for Acme Corp) |

| BlueCherry | BlueCherry ERP by CGS (target for Style Co) |

| Caracal Lynx | Michael's consultancy company — owner of the Sluice toolkit |

