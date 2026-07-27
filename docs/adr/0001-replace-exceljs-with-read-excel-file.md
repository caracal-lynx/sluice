# ADR-0001: Replace exceljs with read-excel-file

- **Status:** Accepted
- **Date:** 2026-07-27
- **Issue:** [DAG-207](https://linear.app/caracal-lynx/issue/DAG-207)

## Context

Sluice reads Excel through `src/adapters/source/xlsx.ts`, which was the only
consumer of `exceljs`. That dependency had become the single largest source of
security churn in the repo.

`exceljs@4.4.0` was published **2023-10-19**; the only npm activity since is a
`4.4.1-prerelease.0` in December 2024. It pulls a chain that pnpm itself flags
as deprecated:

```
archiver@5.3.2, unzipper@0.10.14, fstream@1.0.12,
rimraf@2.7.1, glob@7.2.3, minimatch@3.1.5
```

That chain produced three transitive advisories, each absorbed as a hand-managed
pnpm `override`:

| Override                  | Advisory                             |
| ------------------------- | ------------------------------------ |
| `tmp >=0.2.7`             | GHSA-ph9p-34f9-6g65 (path traversal) |
| `uuid >=11.1.1`           | GHSA-w5hq-g745-h8pq (buffer bounds)  |
| `brace-expansion >=5.0.8` | GHSA-mh99-v99m-4gvg (DoS)            |

The last one was the trigger. Its advisory declares a single vulnerable range
(`<=5.0.7`, patched `5.0.8`) which sweeps in the legacy `1.x`/`2.x` lines old
`minimatch` pulls — lines with **no patch on their branch**. No lockfile refresh
could clear it. Clearing it required forcing every consumer onto `5.x`, in nine
separate repos, because pnpm overrides do not propagate to consumers. That
blocked all 26 open Renovate PRs across the fleet until it landed.

The decisive asymmetry: **Sluice reads Excel only.** We were carrying a full
read/write workbook library, and its entire write-side chain, to do reads.

## Decision

Replace `exceljs` with **`read-excel-file`** (`^9.3.4`).

## Options considered

### 1. DuckDB's `excel` extension — rejected

The most attractive option on paper: DuckDB is already a dependency for staging,
so this would have been a net dependency _removal_. It was tested rather than
assumed, and it failed on three counts:

- **Integers render as `"1.0"`.** DuckDB infers `DOUBLE` for integer columns;
  `CAST(id AS VARCHAR)` yields `"1.0"`, not `"1"`. For a migration tool whose
  output feeds ERP key columns, that is silent data corruption.
- **No sheet enumeration.** `read_xlsx` is the only function the extension
  exposes — there is no `xlsx_sheet_names()`. The adapter's "multiple sheets
  found, using first" warning could not be implemented.
- **No sheet-by-index.** `sheet=1` raises a binder error; only names work. The
  adapter's `source.sheet` accepts a number.

Using `all_varchar=true` avoided the cast problem but made it worse — dates came
back as raw Excel serials (`"46037"`).

### 2. `read-excel-file` — accepted

Read-only, actively maintained (last publish 2026-07-21), and three small modern
dependencies (`fflate`, `unzipper-esm`, `saxen`). Verified against the adapter's
actual semantics before adoption:

- returns every sheet in one call as `{ sheet, data }[]`, so sheet enumeration,
  by-name and by-index selection all fall out naturally
- integers stay integers (`1`, not `1.0`)
- dates arrive as `Date` objects, so ISO formatting is preserved exactly
- formulas are already resolved to their cached result

### 3. `@e965/xlsx` — rejected

The maintained npm mirror of SheetJS. Zero dependencies, but last published
2024-07-19. SheetJS proper was already rejected in 2026-05 because it ships
patches only via its own CDN tarball rather than npm; adopting a mirror
reintroduces that exposure at one remove.

### 4. `node-xlsx` — rejected

Depends on `xlsx` via a literal SheetJS CDN URL
(`https://cdn.sheetjs.com/xlsx-0.20.2/xlsx-0.20.2.tgz`). Precisely the supply
chain we rejected in 2026-05.

### 5. Do nothing — rejected

The honest baseline. Each override is one line, so the cost stays invisible, but
it compounds: three advisories so far, each requiring a fleet-wide rollout, and
the deprecated chain guarantees more.

## Consequences

**Positive**

- `pnpm audit` reports zero advisories — the _full_ audit, not just `--prod`.
- Three overrides deleted (`tmp`, `uuid`, `brace-expansion`). The
  `brace-expansion` pin added earlier the same day became dead config once the
  old `minimatch` chain left the tree.
- The deprecated `archiver`/`unzipper`/`fstream`/`rimraf`/`glob@7` chain is gone.

**Negative / accepted risks**

- **~~Exotic cell types may render differently.~~** _Resolved 2026-07-27 —
  closed by `tests/fixtures/xlsx/rich.xlsx` and a test pinning all four
  renderings._ Measured rather than assumed:

  | Cell type                    | exceljs (before) | read-excel-file (after)     |
  | ---------------------------- | ---------------- | --------------------------- |
  | Rich text (3 formatted runs) | `Caracal Lynx`   | `Caracal Lynx` ✅           |
  | Hyperlink (text ≠ target)    | `Company site`   | `Company site` ✅           |
  | Formula (cached result)      | `2`              | `2` ✅                      |
  | Error cell                   | `#DIV/0!`        | `#ERROR_#DIV/0!` ❌ → fixed |

  Three matched exactly. The error cell did not: read-excel-file prefixes the
  Excel code with its own `#ERROR_` marker, which leaked into staged data.
  `cellToString` now strips that prefix, restoring the pre-DAG-207 output.

- **Test fixtures are now committed binaries.** The suite previously generated
  workbooks at test time with exceljs. With no writer in the tree, the four
  fixtures under `tests/fixtures/xlsx/` are committed `.xlsx` files. This is a
  truer test (it pins the exact bytes parsed) but regenerating them requires a
  writer, which is no longer a dependency — the procedure is a temporary
  `pnpm add -D -w exceljs`, generate, then `pnpm remove -w exceljs`, checking
  `package.json` and `pnpm-lock.yaml` return byte-identical afterwards.
- **Writing Excel is now impossible.** Deliberate — the non-negotiable is that
  Sluice reads Excel only. Any future Excel _target_ adapter needs a new
  decision, not a quiet dependency addition.

## Verification

- `pnpm audit --prod --audit-level=high` — exits 0
- `pnpm audit` (full) — no known vulnerabilities
- `pnpm typecheck`, `pnpm lint` — clean
- `pnpm test` — 557/557, including three new cases (sheet-by-index, absent
  sheet, and the rich text / hyperlink / formula / error-cell rendering test
  added in the follow-up)
