> ⚠️ **SUPERSEDED** — this document was written to upgrade from Node 20 → Node 26 in a single step. The master plan instead upgraded Node 20 → 24 first (Phase 1, complete). The premise (starting from Node 20, needing DuckDB migration) is no longer correct. When the Node 26 upgrade runs (Phase 10, October 2026), it starts from Node 24 and the DuckDB migration is already done. See `node24-upgrade-plan.md` (also archived, executed) and `../SLUICE-IMPLEMENTATION-PLAN.md` §14.
>
> *The content below is retained for historical reference.*

---

# Sluice — Node.js 20 → 26 Upgrade Plan
**Prepared for:** Caracal Lynx Limited / Michael Scott  
**Date:** 2026-04-22  
**Target:** Node.js 26.0.0 (released today — LTS October 2026, EOL April 2029)  
**Audience:** Claude Code — use this document to plan and implement the upgrade  

---

## 1. Why Upgrade Now?

| Version | Status | EOL |
|---|---|---|
| Node.js 20 LTS | **Maintenance mode** (entering EOL soon) | April 2026 |
| Node.js 22 LTS | Active LTS | April 2027 |
| Node.js 24 LTS | Active LTS | April 2028 |
| **Node.js 26** | **Just released — LTS October 2026** | **April 2029** |

Jumping straight to 26 (rather than 22 or 24) gives the longest runway before the next required upgrade — three years of LTS support.

---

## 2. Node.js 20 → 26: Changes That Affect Sluice

### 2.1 OpenSSL — ⚠️ HIGH RISK

**What changed:** Node.js 24 upgraded to OpenSSL 3.5 and set the **default security level to 2** (was 1 in Node 20). Node 26 inherits this and may include OpenSSL 4.0 build support.

Security level 2 prohibits:
- RSA/DSA/DH keys shorter than 2048 bits
- ECC keys shorter than 224 bits  
- RC4 cipher suites
- TLS 1.0 and TLS 1.1 connections

**Sluice impact:**
- `mssql` adapter (Cochran Group): the tedious driver negotiates TLS with SQL Server. If the SQL Server instance is older (2012/2014) or not patched for TLS 1.2, connections **will fail** on Node 26.
- `bc` adapter: OAuth2 token endpoint (`login.microsoftonline.com`) and BC REST API use modern TLS — no risk.
- `pg` adapter: depends on the PostgreSQL server's TLS config — usually fine.

**Action required:** ⚠️ **Before upgrading production**, verify the SQL Server version and TLS configuration at Cochran Group. See Section 4, Phase 0.

**Workaround if SQL Server is old:** You can lower OpenSSL security level in code (not recommended) or configure the connection string to `encrypt: false` only on affected legacy hosts (explicitly documented as a temporary measure until SQL Server is patched).

---

### 2.2 DuckDB Package — 🔴 BREAKING CHANGE (mandatory migration)

**What changed:** The `duckdb` npm package (listed in CLAUDE.md tech stack) is **officially deprecated** as of DuckDB 1.4.x (Fall 2025) and will receive **no further releases** from the 1.5.x series onwards (~Early 2026). The replacement is `@duckdb/node-api` (the "Node Neo" client).

**Key API differences:**

| Old (`duckdb`) | New (`@duckdb/node-api`) |
|---|---|
| Callback-based API | **Promise-native** — no callbacks |
| Requires `duckdb-async` wrapper for `await` | `await` works natively |
| Pre-built binaries per Node version (ABI-sensitive) | Wraps released DuckDB binaries — **ABI-stable** |
| May not build against Node 26 natively | Designed for long-term Node compatibility |

**Sluice impact:** `src/staging/store.ts` uses DuckDB exclusively. The entire store implementation must be rewritten against `@duckdb/node-api`. This is the single largest change in the upgrade.

The good news: Sluice isolates all DuckDB usage behind `StagingStore` — no other module imports from `duckdb` directly (per CLAUDE.md conventions). So the migration is contained to one file.

---

### 2.3 `require(esm)` Now Stable

**What changed:** Synchronous `require()` of ESM modules is **stable** in Node 24+ (it was experimental/broken in Node 20). The module compile cache is also stable.

**Sluice impact:** Low risk for existing code (Sluice is CommonJS/TypeScript compiled to CJS). However, some dependencies may have already gone ESM-only (e.g. newer versions of `csv-parse`, `axios`). Check `engines` fields and `"type": "module"` in dependency `package.json` files during the upgrade.

**Action:** Run `npm ls` after upgrading and check for any ESM-only packages that previously required workarounds.

---

### 2.4 `vm.runInNewContext` — Low Risk, Needs Awareness

**What changed:** A security advisory was raised against Node.js regarding buffer allocation leaks in `vm` module when using the `timeout` option. Node 26 includes security hardening here.

**Sluice impact:** `src/transform/expression.ts` uses `vm.runInNewContext()` for `js:` prefix expressions. The sandbox context provided (`{ row, Date, Math, JSON, String, Number, Boolean }`) is already appropriately minimal.

**Action:** Ensure the `vm.runInNewContext()` call does **not** pass a `timeout` option (which triggers the vulnerable path). If a timeout is needed for safety, use `{ timeout: X, microtaskMode: 'afterExit' }` which is the corrected form.

---

### 2.5 Fetch API — Stable (Positive Change)

**What changed:** `fetch` is fully stable in Node 22+, with `--no-experimental-fetch` flag removed in Node 24.

**Sluice impact:** The `rest` source adapter and `bc` target adapter use `axios`. This is fine — no forced migration needed. However, `axios` could eventually be replaced with native `fetch` for reduced dependency weight. This is an optional future improvement, not a blocker.

---

### 2.6 V8 Engine & Temporal API

**What changed:** V8 updated from ~12.x (Node 20) to ~14.x (Node 26). The `Temporal` API (modern date/time) is now stable in V8 14.4+ and will be available in Node 26.

**Sluice impact:** Sluice uses `dayjs` for all date handling — no change required. The Temporal API is purely additive. No breaking changes to existing date code.

---

### 2.7 npm 11

**What changed:** Node 26 ships with npm 11, which has:
- 65% faster installs for large dependency trees
- Redesigned dependency resolution algorithm
- Automatic vulnerability scanning on install

**Sluice impact:** `package-lock.json` will need to be regenerated with npm 11. The lockfile format changes between npm versions. **Do not mix npm 10 (Node 20) and npm 11 (Node 26) lockfiles.**

---

### 2.8 GitHub Actions CI Update

**What changed:** The CI workflow in CLAUDE.md pins `node-version: '20'`. This must be updated.

**Action:** Update `.github/workflows/ci.yml` to `node-version: '26'`.

---

## 3. Dependency Impact Matrix

| Package | Risk | Action |
|---|---|---|
| `duckdb` | 🔴 **Breaking** | Replace with `@duckdb/node-api`; rewrite `src/staging/store.ts` |
| `mssql` (tedious) | ⚠️ **Conditional** | Verify SQL Server TLS version; may need connection config update |
| `csv-parse` | 🟡 Low | Check current version; may have ESM-only release — pin or update |
| `csv-stringify` | 🟡 Low | Same as above |
| `xlsx` (SheetJS) | 🟢 None | Pure JS; no native bindings |
| `pg` + `@types/pg` | 🟢 None | Pure JS driver; check `engines` field |
| `axios` + `axios-retry` | 🟢 None | Pure JS; no change needed |
| `dayjs` | 🟢 None | Pure JS; no change needed |
| `zod` v3 | 🟢 None | Pure JS; no change needed |
| `js-yaml` | 🟢 None | Pure JS; no change needed |
| `expr-eval` | 🟢 None | Pure JS; no change needed |
| `commander` v12 | 🟢 None | Pure JS; no change needed |
| `pino` + `pino-pretty` | 🟢 None | Check for ESM-only version; likely fine |
| `dotenv` | 🟢 None | Pure JS; no change needed |
| `typescript` 5.x | 🟢 None | Already supports Node 26 targets |
| `tsx` | 🟢 None | Built for modern Node; should work natively |
| `vitest` | 🟢 None | Check engines; actively maintained |
| `eslint` + `@typescript-eslint` | 🟢 None | Check for compatible versions |

---

## 4. Upgrade Path — Phase by Phase

### Phase 0 — Pre-flight (DO FIRST, before touching any code)

**Goal:** Validate environmental assumptions before any code changes.

**Steps:**

1. **Check SQL Server TLS at Cochran Group:**
   ```sql
   -- Run on the Cochran MSSQL instance
   SELECT @@VERSION;
   -- Also check:
   SELECT name, value_in_use FROM sys.configurations WHERE name = 'remote query timeout';
   ```
   Ideally: `SELECT * FROM sys.dm_exec_connections WHERE session_id = @@SPID` to see the encryption protocol in use.
   
   - SQL Server 2016+ with KB4019088 patch → TLS 1.2 → ✅ safe
   - SQL Server 2012/2014 without patch → TLS 1.0 → 🔴 must patch SQL Server first or use connection workaround

2. **Inventory current package versions:**
   ```bash
   cat package.json
   npm ls --depth=0
   ```
   Record exact versions currently in use.

3. **Create an upgrade branch:**
   ```bash
   git checkout -b feat/node26-upgrade
   ```

4. **Install Node 26 alongside Node 20** using `nvm`:
   ```bash
   nvm install 26
   nvm use 26
   node --version  # should print v26.x.x
   ```

---

### Phase 1 — Dependency Updates (low-risk packages first)

**Goal:** Update all non-breaking packages and regenerate the lockfile.

**Steps:**

1. **Update `package.json` engines field:**
   ```json
   "engines": { "node": ">=26.0.0" }
   ```

2. **Update non-breaking packages** (check for newer versions):
   ```bash
   npx npm-check-updates -u --reject duckdb,mssql
   npm install
   ```
   Review every updated package carefully — look for packages that have gone ESM-only.

3. **Regenerate lockfile with npm 11:**
   ```bash
   rm package-lock.json
   npm install
   ```

4. **Run existing tests:**
   ```bash
   npm run build
   npm test
   ```
   Fix any failures before proceeding to the DuckDB migration.

---

### Phase 2 — DuckDB Migration (largest change)

**Goal:** Replace the deprecated `duckdb` package with `@duckdb/node-api` and rewrite `src/staging/store.ts`.

**Steps:**

1. **Install the new package, remove the old:**
   ```bash
   npm uninstall duckdb duckdb-async
   npm install @duckdb/node-api
   ```

2. **Rewrite `src/staging/store.ts`** against the new API.

   Key API differences to handle:

   ```typescript
   // OLD (duckdb / callback style)
   import * as duckdb from 'duckdb';
   const db = new duckdb.Database(path);
   const conn = db.connect();
   conn.run('CREATE TABLE ...', callback);
   conn.all('SELECT ...', callback);
   db.close(callback);

   // NEW (@duckdb/node-api / Promise style)
   import { DuckDBInstance } from '@duckdb/node-api';
   const instance = await DuckDBInstance.create(path);
   const connection = await instance.connect();
   await connection.run('CREATE TABLE ...');
   const result = await connection.runAndReadAll('SELECT ...');
   const rows = result.getRowObjectsJson();  // or .getRows()
   await connection.closeSync();
   await instance.closeSync();
   ```

3. **The `StagingStore` public interface does NOT change.** All callers (`PipelineRunner`, adapters, DQ engine, transform engine) use the `StagingStore` abstraction — they are unaffected by the internal implementation change.

4. **Specific method rewrites in `StagingStore`:**

   | Method | Key change |
   |---|---|
   | `open()` | Use `DuckDBInstance.create(path)` then `instance.connect()` |
   | `close()` | `connection.closeSync()` then `instance.closeSync()` |
   | `createTable()` | `connection.run(ddl)` — unchanged signature |
   | `insertBatch()` | Use prepared statements via `connection.prepare()` for performance |
   | `query<T>()` | `connection.runAndReadAll(sql)` then parse result rows |
   | `exportToCsv()` | DuckDB COPY TO syntax still works: `COPY table TO 'path' (HEADER, DELIMITER ',')` |
   | `columnNames()` | Query `information_schema.columns` or use result metadata |
   | `rowCount()` | `SELECT COUNT(*) FROM table` |
   | `tableExists()` | Query `information_schema.tables` |
   | `dropTable()` | `DROP TABLE IF EXISTS name` |

5. **Remove `duckdb-async` from all imports** (if it was used). The new API is natively async.

6. **Update type references** — `@duckdb/node-api` exports its own type definitions; no `@types/duckdb` needed.

7. **Run staging store unit tests** (`:memory:` mode):
   ```bash
   npx vitest run tests/unit/staging/
   ```
   All insert/query round-trip tests must pass before moving on.

---

### Phase 3 — MSSQL / TLS Validation

**Goal:** Confirm the `mssql` adapter works under OpenSSL 3.5 security level 2.

**Steps:**

1. **If SQL Server is confirmed TLS 1.2 capable** (2016+ or patched):
   - Run integration test against a real MSSQL instance (or a local SQL Server container):
     ```bash
     docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=Test1234!" \
       -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
     ```
   - Run a manual connection test from `src/adapters/source/mssql.ts` against this container.

2. **If SQL Server is old (2012/2014) or version unknown:**
   Add a temporary guard in the MSSQL adapter connection config to enable TLS 1.2 negotiation without downgrading security globally:
   ```typescript
   // In mssql.ts — connection options
   const config = {
     options: {
       encrypt: true,
       trustServerCertificate: false,
       cryptoCredentialsDetails: {
         // Force TLS 1.2 minimum in case server is patched but not advertising 1.3
         minVersion: 'TLSv1.2',
       },
     },
   };
   ```
   Document this clearly with a `// TODO: remove when Cochran SQL Server is confirmed 2022+` comment.

3. **Check `mssql` package version** — ensure it's on v10+ (which uses the latest `tedious` driver with full TLS 1.2/1.3 support):
   ```bash
   npm show mssql version
   # If < 10, update:
   npm install mssql@latest
   ```

---

### Phase 4 — `vm.runInNewContext` Hardening

**Goal:** Ensure the `js:` expression evaluator is safe and robust on Node 26.

**File:** `src/transform/expression.ts`

**Steps:**

1. **Review the `vm.runInNewContext()` call.** Ensure it looks like:
   ```typescript
   import vm from 'node:vm';

   const result = vm.runInNewContext(code, {
     row,
     Date,
     Math,
     JSON,
     String,
     Number,
     Boolean,
   });
   // NOTE: Do NOT add a `timeout` option — the Node 26 security hardening
   // for vm timeout involves buffer allocation; avoid unless strictly needed.
   ```

2. **If execution time safety is needed**, wrap in a `Promise.race` with a `setTimeout` reject rather than using the `timeout` VM option:
   ```typescript
   const EVAL_TIMEOUT_MS = 5000;
   const result = await Promise.race([
     Promise.resolve(vm.runInNewContext(code, sandbox)),
     new Promise((_, reject) =>
       setTimeout(() => reject(new ExpressionError(`Expression timed out: ${code}`)), EVAL_TIMEOUT_MS)
     ),
   ]);
   ```

3. **Ensure `'node:vm'`** is used (the `node:` prefix is the recommended form in Node 22+).

---

### Phase 5 — CI / GitHub Actions Update

**File:** `.github/workflows/ci.yml`

**Changes required:**

```yaml
# Before:
- uses: actions/setup-node@v4
  with: { node-version: '20', cache: 'npm' }

# After:
- uses: actions/setup-node@v4
  with: { node-version: '26', cache: 'npm' }
```

Also update `actions/checkout` and `actions/upload-artifact` to their latest versions if not already on v4:
```yaml
- uses: actions/checkout@v4       # already v4 ✅
- uses: actions/setup-node@v4     # update to v4 ✅
- uses: actions/upload-artifact@v4 # already v4 ✅
```

Optionally add a Node version matrix to catch regressions early:
```yaml
strategy:
  matrix:
    node-version: ['26']
    # Add '24' here if you want to maintain backward compat
```

---

### Phase 6 — Full Test Suite & Coverage Gate

**Goal:** All tests pass, 80% coverage maintained.

**Steps:**

1. **Run the full suite:**
   ```bash
   npm run build
   npm run lint
   npm run test:cov
   ```

2. **Run integration tests** (both fixture pipelines):
   ```bash
   npx vitest run tests/integration/
   ```
   Both `csv-to-csv.test.ts` and `pipeline-runner.test.ts` must pass.

3. **Verify coverage** — DQ and Transform must remain at ≥80% line coverage.

4. **Test the CLI manually** with a dry-run:
   ```bash
   npx tsx src/cli.ts run tests/fixtures/cochran-customers.pipeline.yaml --dry-run
   npx tsx src/cli.ts run tests/fixtures/eribe-styles.pipeline.yaml --dry-run
   npx tsx src/cli.ts check tests/fixtures/cochran-customers.pipeline.yaml
   ```

5. **Check exit codes** are correct (0/1/2/3).

---

### Phase 7 — CLAUDE.md and Documentation Update

1. **Update `CLAUDE.md` tech stack table:**
   ```markdown
   | Runtime | Node.js 26 LTS | No Bun, no Deno — must run in GitHub Actions |
   | Staging | `@duckdb/node-api` | Replaces deprecated `duckdb` package |
   ```

2. **Update `.env.example`** — no changes needed.

3. **Update `package.json`** engines field:
   ```json
   "engines": { "node": ">=26.0.0" }
   ```

4. **Update `README`** if it mentions Node 20.

---

## 5. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cochran SQL Server TLS incompatibility | Medium (version unknown) | High — breaks MSSQL adapter | Verify SQL Server version before upgrade; patch if needed |
| `@duckdb/node-api` API surface gaps | Low | Medium — blocks staging layer | Read official migration guide; test in `:memory:` mode first |
| ESM-only dependencies breaking build | Low | Medium — build fails | Run `npm ls` after update; check `"type": "module"` in deps |
| `vm.runInNewContext` security regression | Low | Low — Sluice context is minimal | Don't use `timeout` option; test `js:` expressions in suite |
| npm 11 lockfile incompatibility | Low | Low — dev friction only | Delete and regenerate `package-lock.json` |
| GitHub Actions runner not supporting Node 26 | Very Low | Low | `ubuntu-latest` supports Node 26 on day of release |

---

## 6. Rollback Plan

If the upgrade hits a blocker (most likely: SQL Server TLS issue in production):

1. Keep the `feat/node26-upgrade` branch uncommitted to `main`.
2. Consider upgrading to **Node 22 LTS** as an interim step — it avoids most OpenSSL risk while still getting off Node 20.
3. Address the SQL Server TLS issue separately, then complete the Node 26 upgrade.

---

## 7. Recommended Upgrade Sequence

```
Phase 0: Pre-flight checks (SQL Server TLS, lockfile inventory)
    ↓
Phase 1: Low-risk dependency updates + lockfile regeneration
    ↓
Phase 2: DuckDB migration (@duckdb/node-api) ← biggest change
    ↓
Phase 3: MSSQL TLS validation
    ↓
Phase 4: vm.runInNewContext hardening
    ↓
Phase 5: CI update
    ↓
Phase 6: Full test suite + coverage gate
    ↓
Phase 7: Docs + merge to main
```

**Estimated effort:** 1–2 days for an experienced developer, with the DuckDB rewrite being the majority of the work (~4–6 hours).

---

## 8. Key References

- [Node.js v22 to v24 Migration Guide](https://nodejs.org/en/blog/migrations/v22-to-v24)
- [Node.js 26 Release Issue](https://github.com/nodejs/node/issues/61832)
- [DuckDB Node Neo (`@duckdb/node-api`)](https://github.com/duckdb/duckdb-node-neo)
- [DuckDB Node.js API Docs](https://duckdb.org/docs/lts/clients/nodejs/overview)
- [OpenSSL Security Level 2 Issue (Node 24)](https://github.com/nodejs/node/issues/59715)
- [Node.js Release Schedule](https://nodejs.org/en/about/previous-releases)

---

*This document was generated on 2026-04-22 — the day Node.js 26 was released. Update the DuckDB section if `@duckdb/node-api` has released a version newer than 1.5.x, as the API may have further stabilised.*
