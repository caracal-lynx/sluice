# Sluice — Node.js 20 → 26 Upgrade: Execution Plan

*Complements [node26-upgrade-plan.md](node26-upgrade-plan.md) — the strategy doc
— with concrete, file-level changes adjusted for what the codebase actually
looks like today.*

**Status:** Paused 2026-04-24 — Node 26 is not yet available via nvm-windows
(strategy doc claimed a 2026-04-22 release, but `nvm install 26` reports "not
yet released or not available for download yet"; latest available is 25.9.0).
Resume when Node 26 is installable.

**Branch:** `features/node26-upgrade`

---

## Context

Node.js 20 enters EOL April 2026. The branch `features/node26-upgrade` already
exists; `docs/node26-upgrade-plan.md` outlines the strategy in detail. This plan
translates that doc into concrete, file-level changes, adjusted for what the
codebase actually looks like today.

**Goal:** Move Sluice to Node 26 (LTS October 2026, EOL April 2029) so we have
three years of runway, without changing `StagingStore`'s public API or any
YAML-facing behaviour.

---

## Current state vs. the upgrade doc

Exploration revealed three meaningful differences from the doc's assumptions.
All three make the upgrade *easier*, not harder:

| Doc assumption | Actual state | Impact |
|---|---|---|
| Sluice is CommonJS/TS compiled to CJS | `package.json` has `"type": "module"` — it's already ESM | No ESM/CJS migration pain. DuckDB CJS import at [store.ts:8-13](../src/staging/store.ts) already uses the correct default-import-and-destructure interop pattern. |
| Need to verify `mssql` is on v10+ | Already on `^11.0.1` | Skip the version bump; just re-pin lockfile. |
| Need to ensure `'node:vm'` is used | Already imported from `'node:vm'` at [expression.ts:11](../src/transform/expression.ts) | Nothing to change on that line. |
| Ensure `timeout` option is NOT passed to `vm.runInNewContext` | **It currently IS passed** (`timeout: 1000`, [expression.ts:37](../src/transform/expression.ts)) | **Concrete change required** — remove the `timeout` option (see Phase 4). |

No `engines` field currently exists in `package.json` — it must be **added**, not just updated.

Also: npm is already at 11.12.1, so the doc's "do not mix npm 10 and npm 11
lockfiles" concern is moot. Current Node is v24.15.0 LTS.

---

## Phase 0 — Pre-flight (read-only)

**Goal:** Validate environmental assumptions before touching any code.

1. **Verify SQL Server TLS at Acme Corp** (blocking for production cut-over,
   but not for the code work itself). The doc's SQL snippets in
   `docs/node26-upgrade-plan.md` §4 Phase 0 stand as-is.
   - SQL Server 2016+ with KB4019088 patch → TLS 1.2 → safe.
   - SQL Server 2012/2014 unpatched → TLS 1.0 → will fail under OpenSSL SL2
     unless mitigated in-code (Phase 3).
2. **Install Node 26 locally** via `nvm-windows`; confirm `node --version`.
   *(Currently blocked — not yet published to nvm-windows registry as of
   2026-04-24.)*
3. **Confirm branch:** we are already on `features/node26-upgrade`. Good.

---

## Phase 1 — Engines field, dep refresh, lockfile regen

**Files:** `package.json`, `package-lock.json`.

1. Add `"engines": { "node": ">=26.0.0" }` to `package.json`.
2. Bump `@types/node` from `^20.17.0` to `^26.x` (dev dep).
3. Run `npx npm-check-updates -u --reject duckdb,mssql` — let non-blocking
   packages float to latest. Review each bump (esp. `eslint`,
   `typescript-eslint`, `vitest`) for breaking changes in release notes before
   accepting.
4. Delete `package-lock.json` and run `npm install` under Node 26 / npm 11
   to regenerate the lockfile cleanly.
5. `npm run build && npm test` to make sure the low-risk sweep hasn't broken
   anything before we touch DuckDB.

---

## Phase 2 — DuckDB migration (the big one)

**Goal:** Replace deprecated `duckdb` with `@duckdb/node-api` (Node Neo).

**Files:** `src/staging/store.ts` (rewrite), `package.json` (dep swap).
**Not changed:** `src/staging/schema.ts` (pure SQL helpers), `src/staging/index.ts`
(barrel), any caller of `StagingStore` — the public surface stays identical.

**Dep swap:**
```
npm uninstall duckdb
npm install @duckdb/node-api
```
(`duckdb-async` is not currently installed — no uninstall needed.)

**Rewrite plan for `src/staging/store.ts`:**

The current file is 200 lines with a single internal `exec()` callback-wrapper
([store.ts:182-198](../src/staging/store.ts)) feeding every public method. All
11 public methods keep identical signatures; only their bodies change.

| Public method (current → keep) | New-API call |
|---|---|
| `open()` [store.ts:35](../src/staging/store.ts) | `await DuckDBInstance.create(dbPath)` → `await instance.connect()` |
| `close()` [store.ts:57](../src/staging/store.ts) | `await connection.closeSync()` → `await instance.closeSync()` |
| `createTable(name, cols)` [store.ts:70](../src/staging/store.ts) | `await connection.run(buildCreateTableSql(...))` — reuses existing `buildCreateTableSql` from `src/staging/schema.ts` |
| `insertBatch(table, rows)` [store.ts:78](../src/staging/store.ts) | `connection.prepare(sql)` + bind params; or parameterised `run()` — preserve the batched multi-VALUES shape for perf |
| `query<T>(sql, params)` [store.ts:95](../src/staging/store.ts) | `const r = await connection.runAndReadAll(sql, params); return r.getRowObjectsJson() as T[]` |
| `tableExists(name)` [store.ts:100](../src/staging/store.ts) | Same SQL; swap result-shape helpers |
| `dropTable(name)` [store.ts:109](../src/staging/store.ts) | `await connection.run(...)` |
| `rowCount(table)` [store.ts:113](../src/staging/store.ts) | Same SQL; `Number(bigint)` coercion still needed |
| `columnNames(table)` [store.ts:120](../src/staging/store.ts) | Same SQL; unpack via new result API |
| `exportToCsv(...)` [store.ts:132](../src/staging/store.ts) | `COPY TO` SQL is unchanged across DuckDB versions; just `connection.run(...)` |
| `renameColumns(...)` [store.ts:157](../src/staging/store.ts) | `CREATE OR REPLACE TABLE ... AS SELECT` is unchanged; `connection.run(...)` |

**Things to watch for during the rewrite:**
- The top-of-file comment at [store.ts:11-13](../src/staging/store.ts) about
  CJS interop becomes stale — `@duckdb/node-api` ships native ESM.
- `TableData` type import disappears; use the new API's result types.
- BigInt handling: the new API still returns BigInt for counts. Keep
  `Number(rows[0]?.n ?? 0)` coercion pattern ([store.ts:106](../src/staging/store.ts),
  [store.ts:117](../src/staging/store.ts)).
- `@types/duckdb` is not used and no shim is needed — the new package is
  typed natively.

**Verification:** `npx vitest run tests/unit/staging/` must pass against
`:memory:` before moving on. Then the integration tests
(`tests/integration/csv-to-csv-mvp.test.ts`,
`tests/integration/multi-source-runner.test.ts`) exercise `renameColumns`,
`exportToCsv`, and the full insert→query→export loop end-to-end.

---

## Phase 3 — MSSQL / TLS hardening

**File:** `src/adapters/source/mssql.ts`.

`mssql@^11.0.1` already uses the latest tedious driver — no package change
needed. The risk is OpenSSL 3.5 security level 2 refusing TLS 1.0/1.1
connections that Node 20 accepted.

**Change:** in the connection config builder (lines ~70-96 per exploration),
add an explicit minimum TLS version so behaviour is predictable whether or
not Acme Corp's SQL Server is patched:

```typescript
options: {
  encrypt: <existing>,
  trustServerCertificate: <existing>,
  cryptoCredentialsDetails: { minVersion: 'TLSv1.2' },
}
```

This is defensive: on a patched server (TLS 1.2 or 1.3) it's a no-op; on an
unpatched server it fails fast with a clear error instead of a confusing
OpenSSL handshake failure. Add a short inline comment pointing at the Acme Corp
SQL Server verification TODO (Phase 0 action).

**Verification:** existing unit tests in `tests/unit/adapters/source/mssql*`
must continue to pass (they mock the driver, so this config change passes
through). A live smoke-test against a local `mcr.microsoft.com/mssql/server:2022-latest`
container is only required if SQL Server 2012/2014 is confirmed in scope.

---

## Phase 4 — `vm.runInNewContext` timeout removal

**File:** `src/transform/expression.ts`.

**Concrete change** — at [expression.ts:37](../src/transform/expression.ts),
the current code passes `{ timeout: 1000 }` to `runInNewContext`. The upgrade
doc §2.4 explicitly warns this is the vulnerable path under Node 26 security
hardening. Remove it.

Drop the timeout option entirely. The sandbox is already minimal
(`row, Date, Math, JSON, String, Number, Boolean`), expressions are authored
by pipeline YAML owners (trust boundary), and every `js:` use is already
logged at warn level ([expression.ts:24](../src/transform/expression.ts)).

Do **not** introduce the `Promise.race`/`setTimeout` wrapper suggested in the
doc — `vm.runInNewContext` is synchronous, so wrapping it in a Promise cannot
actually interrupt runaway code. The doc's own example is misleading; dropping
the option is the correct minimal change.

**Verification:** `npx vitest run tests/unit/transform/expression.test.ts`
must pass unchanged.

---

## Phase 5 — CI workflow bump

**File:** `.github/workflows/ci.yml`.

Change [ci.yml:15](../.github/workflows/ci.yml) from `node-version: '20'` to
`node-version: '26'`. All action versions (`checkout@v4`, `setup-node@v4`,
`upload-artifact@v4`) are already current — no other changes.

Skip the version matrix the doc suggests; we're committing to Node 26 only.

---

## Phase 6 — Full suite + docs

1. `npm run build && npm run lint && npm run test:cov`.
2. Manual CLI smoke tests (from doc §4 Phase 6 step 4) on both fixture
   pipelines.
3. Verify coverage: DQ and Transform ≥80% line coverage preserved.
4. Update `CLAUDE.md` tech-stack table:
   - Runtime: `Node.js 26 LTS`
   - Staging: `@duckdb/node-api` (replaces `duckdb`)
5. Update `README.md` if it mentions Node 20.

---

## Critical files

| File | Change |
|---|---|
| [package.json](../package.json) | Add `engines.node`, swap `duckdb` → `@duckdb/node-api`, bump `@types/node`, float non-critical deps |
| [package-lock.json](../package-lock.json) | Delete and regenerate under npm 11 |
| [src/staging/store.ts](../src/staging/store.ts) | Full rewrite against `@duckdb/node-api`; public surface preserved |
| [src/adapters/source/mssql.ts](../src/adapters/source/mssql.ts) | Add `cryptoCredentialsDetails.minVersion: 'TLSv1.2'` |
| [src/transform/expression.ts](../src/transform/expression.ts) | Remove `{ timeout: 1000 }` option |
| [.github/workflows/ci.yml](../.github/workflows/ci.yml) | `node-version: '26'` |
| [CLAUDE.md](../CLAUDE.md) | Tech-stack table: Node 26, `@duckdb/node-api` |

**Unchanged** (confirmed by exploration): `src/staging/schema.ts`,
`src/staging/index.ts`, all runner/adapter/DQ/transform/merge modules,
all test fixtures, all YAML pipelines.

---

## Verification

**Unit:** `npx vitest run tests/unit/` — every suite must pass, with
special attention to `tests/unit/staging/` (rewritten layer) and
`tests/unit/transform/expression*` (behaviour-preserving change).

**Integration:**
```
npx vitest run tests/integration/
```
- `csv-to-csv-mvp.test.ts` — end-to-end single-source round trip.
- `multi-source-runner.test.ts` — exercises `renameColumns` + merge SQL.
- `merge-strategies.test.ts` — exercises all four built-in strategies
  against the new DuckDB layer.

**Manual CLI:**
```
npx tsx src/cli.ts run tests/fixtures/acme-corp-customers.pipeline.yaml --dry-run
npx tsx src/cli.ts run tests/fixtures/style-co-styles.pipeline.yaml --dry-run
npx tsx src/cli.ts check tests/fixtures/acme-corp-customers.pipeline.yaml
```
Exit codes: 0 success · 1 pipeline error · 2 DQ critical · 3 config error.

**CI:** after merging Phase 5 CI change, let GitHub Actions run lint +
build + test:cov under `ubuntu-latest` + Node 26 before merging to `master`.

**Rollback:** if the DuckDB migration blocks (most likely cause), we fall
back to Node 22 LTS as an interim step (keeps us off Node 20 and avoids
OpenSSL SL2, at the cost of re-visiting the DuckDB migration later). The
branch `features/node26-upgrade` should not be force-pushed to `master`
until all verification steps pass.

---

## Estimated effort

1–2 days of focused work. Phase 2 (DuckDB rewrite) is ~60% of the time;
everything else is hours, not days.
