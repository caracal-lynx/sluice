@c:/repos/standards/company.md

@c:/repos/standards/coding/typescript-standards.md

# Sluice — CLAUDE.md

Config-driven ETL toolkit for data migrations. npm: `@caracal-lynx/sluice`.
Owner: Caracal Lynx Limited (SC826823). Last updated: 2026-06-14.

## Sluice in one paragraph

The engine is written once; each client engagement is delivered as a folder of
YAML pipeline configs in a private `sluice-client-<name>` repo. No UI, no server,
no cloud dependency — just the `sluice` CLI plus TypeScript modules importable
by other tools (n8n custom nodes, GitHub Actions). Pipelines extract from
legacy SQL / CSV / Excel / REST sources, validate against configurable DQ
rules, transform via mappings + lookups + expressions, and load to IFS,
Business Central, BlueCherry, or generic CSV/JSON.

_Clean data flows through._

## Non-negotiables

- No web UI or dashboard
- No streaming / real-time ingestion
- DuckDB is staging only — never a warehouse, never a server
- Single-tenant consultant's toolkit; not a SaaS product
- Must run from Windows PowerShell 7 _and_ unattended in GitHub Actions

## Package manager — pnpm

**Sluice uses pnpm.** It was the Data Gubbins pnpm pilot (DAG-61, 2026-06-14)
that led the fleet migration; as of **DAG-145 (2026-06-17) pnpm is the realised
`[STACK-01]` baseline** across every `sluice-*` repo, so this is no longer a
deviation/override — the standards doc now says pnpm too. The notes below are
sluice-specific operational detail, not a `[SCOPE-02]` exception.

Rule specifics worth restating for this repo:

- `[STACK-01]` package manager is **pnpm** (`pnpm-lock.yaml` committed, not `package-lock.json`).
- `[SEC-06]` CI installs with **`pnpm install --frozen-lockfile`**, not `npm ci`.
- `[CORE-10]` / `[DONE-01]` pre-review gate is **`pnpm typecheck && pnpm lint && pnpm test`**.
- `[LINT-04]` lefthook is activated by a fresh **`pnpm install`** (via `prepare`).
- `[DEP-01]` Renovate still owns version bumps; it also auto-bumps `packageManager`.

Operational notes:

- **Standalone pnpm honours the pin — no corepack** (DAG-152). Node is managed by [`fnm`](https://github.com/Schniz/fnm) (reads `.nvmrc`); pnpm is the **official standalone install** (`get.pnpm.io`, on `PNPM_HOME`). The standalone launcher self-honours the `packageManager: pnpm@11.7.0` pin automatically — it downloads and runs the pinned version even when the launcher itself is a different build — so `pnpm -v` here is **11.7.0** with no corepack, no `corepack enable`, and no elevation. Do **not** run `pnpm config set manage-package-manager-versions true`: that key is rejected by pnpm 11's global config (`ERR_PNPM_CONFIG_SET_UNSUPPORTED_YAML_CONFIG_KEY`) and the self-management is on by default. Verified corepack-free on Node 26 (where corepack is unbundled).
- **Workspace** — root (the published package) + `docs-site` (Astro docs) share one `pnpm-lock.yaml` via `pnpm-workspace.yaml`. Build docs with `pnpm --filter docs-site build`.
- **Renovate `rangeStrategy: update-lockfile`** (`renovate.json`) — overrides the shared preset's `bump`. With `bump`, in-range caret updates desync the lockfile importer specifier for non-root workspace members (`docs-site`), failing `--frozen-lockfile` in CI. Don't revert to `bump` while this stays a pnpm repo. Folding this + `minimumReleaseAge` into a shared `.github` pnpm preset is tracked in **DAG-144**.
- **pnpm 11 `minimumReleaseAge` (24h, on by default)** — pnpm refuses to install versions published <1 day ago and re-validates this on `pnpm install --frozen-lockfile`, so a same-day dependency bump fails CI with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` until it ages out. `renovate.json` sets `minimumReleaseAge: "3 days"` so Renovate only opens a PR once it can pass. It's a supply-chain safeguard — don't disable pnpm's gate; for an urgent patch use `minimumReleaseAgeExclude`.
- **Never let `pnpm install` re-emit `pnpm-lock.yaml` for a one-line fix** — pnpm 10's YAML serializer rewrites `resolution:` blocks (compact → expanded), churning thousands of lines. To sync a stale specifier, edit the single line directly; reserve a full `pnpm install --lockfile-only` for genuine dependency changes.
- **End users are unaffected** — consumers still `npm install @caracal-lynx/sluice` (or any PM); pnpm is an internal dev/CI choice only.

## Sluice-specific stack

Additions and deviations from the programme baseline in
[data-gubbins.md](c:/repos/standards/programmes/data-gubbins.md) — anything
not listed here follows the programme stack.

| Concern    | Package                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL Server | `mssql`                       | Trusted + SQL auth both supported                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PostgreSQL | `pg` + `@types/pg`            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CSV        | `csv-parse` + `csv-stringify` | Streaming                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Excel      | `read-excel-file`             | Read-only by design. Replaced `exceljs` in 2026-07 (DAG-207) — exceljs was stale (last real release 2023-10) and its `archiver`/`unzipper`/`glob` chain produced three transitive advisories. See [ADR-0001](c:/repos/sluice/docs/adr/0001-replace-exceljs-with-read-excel-file.md). Earlier still, `xlsx`/SheetJS was dropped in 2026-05 over two unpatched HIGH advisories (SheetJS ships patches only via their CDN tarball, not npm) — so do not "simplify" back to it. |
| HTTP retry | `axios-retry`                 | 3 retries, exponential backoff                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Env vars   | `dotenv`                      | Loaded once at CLI entry                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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

## TypeScript config

- **Full `[C-01]` strict baseline is on** (DAG-10): `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `isolatedModules`, `useUnknownInCatchVariables`,
  `noImplicitOverride`, etc. are all enabled in `tsconfig.json`.
- **`[SCOPE-02]` deviation — `target`/`lib` are `ES2025`, not the baseline `ES2024`.**
  Intentional: `engines.node` is `>=24.16.0` (`.nvmrc` 24.17.0), which fully supports
  ES2025, so Sluice runs one notch ahead of the `[C-01]` baseline tsconfig.
- **Tests are not yet typechecked.** `pnpm typecheck` covers `src/` only;
  `tsconfig.test.json` is used solely as the ESLint parser project, so test type
  errors are latent. Wiring tests into the typecheck gate (and clearing the backlog)
  is tracked in **DAG-169** — don't assume test type-safety until it lands.
- **Two vitest projects, `unit` and `integration`** (DAG-208). Unit keeps the 5s
  default so a hung test fails fast; integration gets 30s for `testTimeout` _and_
  `hookTimeout` because it stands up real DuckDB staging and drives the CLI — on
  Windows those were running at 60–110% of the 5s default and flaking. Run one
  with `pnpm vitest run --project unit|integration`. **A new test directory needs
  adding to a project's `include`** or it silently runs nowhere; after touching
  `vitest.config.ts`, check the file/test counts still match.

## Targets

- **IFS** — CSV import via IFS bulk-load utility (`src/adapters/target/ifs.ts`)
- **Business Central** — REST API + OAuth2 client credentials, token managed by
  `BcTokenManager` (`src/adapters/target/bc.ts`)
- **BlueCherry** — CSV import (`src/adapters/target/bluecherry.ts`)
- **Generic** — `csv`, `pg`

## CI / Release

Sluice consumes the org-wide reusable workflows from
[`caracal-lynx/.github`](https://github.com/caracal-lynx/.github). The local
`.github/workflows/` files are thin consumer wrappers — don't add custom CI
steps here unless they're genuinely Sluice-specific (like `ci-tsgo.yml` or
`docs.yml`).

- `.github/workflows/ci.yml` — calls `caracal-lynx/.github`'s `node-ci.yml`, pinned to a released tag (Renovate-managed — check the file for the current version; `@master` is no longer used, see DAG-67). Runs lint / typecheck / test / build / security audit / changeset.
- `.github/workflows/release.yml` — calls `caracal-lynx/.github`'s `node-release.yml`, pinned to a released tag (Renovate-managed). Changesets PR-flow + npm Trusted Publishing (OIDC, no `NPM_TOKEN` — rationale + recovery path in standards [ADR-0003](https://github.com/caracal-lynx/standards/blob/master/docs/adr/0003-npm-trusted-publishing.md)). **Linear release sync is on** (`sync-linear: true`, DAG-74): every npm publish creates a completed release in the **Sluice** Linear pipeline, linking the issues referenced in that release's commit range. To be picked up, reference the issue as `DAG-NN` (uppercase) or a PR as `#NN` in the **commit message or PR description** — the house `[<branch>] -` prefix only carries a lowercase branch slug, so the PR description/title (which we already tag with `DAG-NN`) is the reliable carrier; issues linked only via a merged PR are resolved too.
- `.github/workflows/ci-tsgo.yml` — **Sluice-specific.** Non-blocking parallel tsgo typecheck, ahead of the planned TypeScript 7 upgrade. Drop when TS 7 stable.
- `.github/workflows/docs.yml` — **Sluice-specific.** Astro docs-site build + GitHub Pages deploy. Stays local.

Want to change CI behaviour across the fleet (different Node version, add a
job, etc.)? Open a PR on `caracal-lynx/.github`, not on Sluice. Sluice's
consumer just passes inputs.

### Transitive vuln overrides (`overrides`)

These live under **`overrides`** in `pnpm-workspace.yaml` — since pnpm 11 the
`pnpm` field in `package.json` is no longer read, so settings moved to the
workspace file (see https://pnpm.io/settings). Only the workspace-root file is
honoured (so docs-site's `devalue` override lives here too). Renovate does not
manage these; review and drop each when its parent ships a patched release.

- **`esbuild >=0.28.1`** — [GHSA-gv7w-rqvm-qjhr](https://github.com/advisories/GHSA-gv7w-rqvm-qjhr) (binary integrity, dev-only via `tsx`/`vitest`/`astro`). Surfaced by pnpm's workspace-wide audit.
- **`devalue >=5.8.1`** — docs-site (`astro`) transitive.

**Three overrides were removed in 2026-07 when `exceljs` went (DAG-207)** — `tmp`, `uuid`, and `brace-expansion`. All three existed only to patch exceljs's transitive chain; with the dependency gone, `pnpm audit` (full, not just `--prod`) reports zero advisories without them. If a future change reintroduces a heavyweight Excel writer, expect these to come back with it.

### pnpm build-script allowlist (`allowBuilds`)

pnpm does **not** run dependency install/build scripts unless allowlisted. The
`allowBuilds` map in `pnpm-workspace.yaml` lists `esbuild`, `lefthook`, `sharp`
(pnpm 11 renamed this from the `onlyBuiltDependencies` array). Note
`@duckdb/node-api` is **not** listed — it has no build script (it ships
platform-specific prebuilt binaries as optional deps). pnpm 11 **fails** the
install (`ERR_PNPM_IGNORED_BUILDS`) on a non-allowlisted build script rather
than just warning, so add it here (or run `pnpm approve-builds`).

## Related docs

- [README.md](c:/repos/sluice/README.md) — install, quick-start, composite rules (Tier 1)
- [PLUGINS.md](c:/repos/sluice/PLUGINS.md) — Tier 2 (file) and Tier 3 (npm) plugin authoring
- [docs/architecture-diagrams.md](c:/repos/sluice/docs/architecture-diagrams.md) — pipeline flow Mermaid diagrams
