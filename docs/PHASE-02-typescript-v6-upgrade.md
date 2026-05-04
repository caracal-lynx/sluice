# Sluice — TypeScript 5 → 6 → 7 Upgrade Plan

> 🟢 **STATUS: READY** — Phase 1 (Node 24 + DuckDB Neo) shipped 3 May 2026 in PR #8, so this upgrade is unblocked. This document is the Claude Code-ready execution plan for Phase 2. For TypeScript 7 (Phase 11), see [PHASE-11-typescript-v7-spec.md](PHASE-11-typescript-v7-spec.md) and the tsgo sections below.

**Prepared for:** Caracal Lynx Ltd. / Michael Scott  
**Date:** 2026-04-22  
**Prerequisite:** Node.js 24 upgrade complete — Phase 1 shipped (see `docs/archive/node24-upgrade-plan.md`)  
**Audience:** Claude Code — use this document to plan and implement the upgrade  

---

## 1. Version Landscape

| Version | Released | Status | Key Significance |
|---|---|---|---|
| TypeScript 5.x | 2023–2025 | ~~Current in Sluice~~ **Superseded** | Last era of incremental strict additions |
| **TypeScript 6.0** | **March 23, 2026** | ✅ **Current in Sluice** | Last JS-based compiler; defaults tightened; bridge to TS 7 |
| **TypeScript 7.0** | **January 15, 2026** | **Stable** | Native Go compiler (tsgo); 10× faster; 98% API-compatible |

Both target versions are already released. TS 7 actually pre-dates TS 6 in release order, but the intended migration path is **5 → 6 → 7**, with TS 6 acting as the compatibility bridge.

---

## 2. Sluice Starting Position — What's Already Right

Based on the confirmed tsconfig settings, Sluice is in the **best possible starting position** for this migration:

| Setting | Current | TS 6 requirement | Status |
|---|---|---|---|
| `strict` | `true` | Now default (but still respected if explicit) | ✅ No change |
| `exactOptionalPropertyTypes` | `true` | No change | ✅ No change |
| `module` | `nodenext` | `node`/`classic` removed; `nodenext` ✅ | ✅ No change |
| `moduleResolution` | `nodenext` | `node10`/`classic` removed; `nodenext` ✅ | ✅ No change |
| Decorators | None used | TS 7 tsgo has limited decorator support | ✅ No blocker |

The single biggest TS 6 landmine — `moduleResolution: "node"` being removed — is already cleared.

---

## 3. TypeScript 5 → 6: What Changes

### 3.1 Defaults That Changed (but Sluice already matches)

These are **default** changes that only affect projects that didn't have them set. Sluice already sets them explicitly — no surprises.

| Setting | Old default | New default | Sluice impact |
|---|---|---|---|
| `strict` | `false` | `true` | ✅ Already `true` |
| `target` | `ES3` | `ES2025` | ⚠️ Set explicitly — see §3.3 |
| `module` | `commonjs` | `esnext` | ✅ Already `nodenext` |
| `esModuleInterop` | `false` | Always `true` (can't set `false`) | ✅ Almost certainly already `true` |

### 3.2 Options Removed or Broken in TS 6

| Option | Action |
|---|---|
| `moduleResolution: "node"` / `"classic"` | **Removed.** Sluice uses `nodenext` — ✅ unaffected |
| `target: "ES5"` | **Removed.** Minimum is now ES2015. Sluice targets higher. |
| `outFile` | **Removed.** Sluice doesn't use it. ✅ |
| `module: "AMD"` / `"UMD"` | **Deprecated.** Sluice doesn't use them. ✅ |
| `esModuleInterop: false` | **Can no longer be set to `false`.** If present in tsconfig, remove it. |
| `allowSyntheticDefaultImports: false` | **Same — remove if present.** |

### 3.3 Target and Lib Update (recommended, not forced)

With Node.js 26 in place, the runtime natively supports ES2025. Update `target` and `lib` accordingly:

```jsonc
// tsconfig.json — recommended TS 6 values (Node 26 runtime)
{
  "compilerOptions": {
    "target": "ES2025",      // was probably ES2022; Node 26 supports ES2025
    "lib": ["ES2025"],       // adds Temporal, RegExp.escape, Iterator helpers
    "module": "nodenext",    // unchanged ✅
    "moduleResolution": "nodenext"  // unchanged ✅
  }
}
```

**Why ES2025?** TypeScript 6 ships built-in types for the `Temporal` API (the modern date/time replacement for `Date`). Sluice uses `dayjs` and won't switch, but having the Temporal lib types available avoids ambient type conflicts.

### 3.4 Import Assertions: `assert` → `with` (check, probably N/A)

TS 6 deprecates the old `assert` import syntax in favour of `with`:

```typescript
// Deprecated (TS 6 warning, TS 7 error):
import data from './data.json' assert { type: 'json' };

// Correct:
import data from './data.json' with { type: 'json' };
```

**Sluice impact:** YAML is loaded via `js-yaml` (not import assertions), and JSON configs are handled similarly. Almost certainly **not used** — but run the grep in Phase 1 to confirm.

### 3.5 `--stableTypeOrdering` Flag (opt-in bridge to TS 7)

TS 6 ships a new flag that pre-adopts TS 7's type ordering behaviour. Enabling it now means fewer diffs when upgrading to TS 7:

```jsonc
{
  "compilerOptions": {
    "stableTypeOrdering": true
  }
}
```

This is recommended but not required. Enable it and fix any new ordering-related errors before moving to TS 7.

### 3.6 New / Tighter Inference in TS 6 (most likely source of errors)

TypeScript 6 improves inference for methods, generic return types, and conditional types. This won't break well-typed code, but it **will surface latent type errors** that TS 5 was silently accepting.

**Sluice files most likely to see new errors:**

| File | Why |
|---|---|
| `src/transform/engine.ts` | Heavy use of generic field-type dispatch (`switch` on `FieldType` enum) and `unknown` narrowing |
| `src/dq/engine.ts` | `Rule.validate(value: unknown, ...)` return type narrowing; violation array indexing |
| `src/adapters/source/rest.ts` | Dot-path navigation into untyped JSON (`unknown` → nested access) |
| `src/staging/store.ts` | DuckDB result row typing (especially after the `@duckdb/node-api` migration) |
| `src/config/loader.ts` | Dynamic object construction from parsed YAML before Zod validation |

**Strategy:** Run `npx tsc --noEmit` immediately after installing TS 6. Collect all new errors. Fix systematically — do NOT use `as any` to suppress; use proper narrowing with `unknown` and type guards consistent with the existing error-handling patterns in `src/utils/errors.ts`.

### 3.7 `@typescript-eslint` Version Compatibility

The `@typescript-eslint` parser and rules packages typically lag a few weeks behind major TypeScript releases. 

**Action:** Before installing TS 6, check:
```bash
npm show @typescript-eslint/parser peerDependencies
```
Ensure it lists TypeScript 6 as a supported peer. If not, pin TS 6 and wait for the `@typescript-eslint` update — usually a short wait.

---

## 4. TypeScript 6 → 7: What Changes

### 4.1 The Big Picture — The Go Rewrite (tsgo)

TypeScript 7 is a **complete rewrite of the compiler in Go** (Project Corsa). The TypeScript language itself is unchanged — the same syntax, the same type system, the same `tsconfig.json`. What changes is:

- `tsc` (JavaScript-based) → `tsgo` (native binary)
- 10× faster full builds
- 3× lower memory usage
- Sub-100ms watch mode restarts
- VS Code: 77s type-check → 7.5s (from the VS Code codebase benchmark)

**Sluice's ~50 source files will type-check in under 1 second.** The current TS 5 check probably takes 3–8 seconds.

### 4.2 Compatibility: What tsgo Supports

| Feature | Status in tsgo |
|---|---|
| All TS 6 type checking | ✅ 98%+ compatible |
| `nodenext` / `bundler` moduleResolution | ✅ |
| Path aliases (`@/*`) | ✅ |
| Zod `z.infer<>` patterns | ✅ (35% faster infer) |
| `exactOptionalPropertyTypes` | ✅ |
| `stableTypeOrdering` | ✅ (tsgo native behaviour) |
| **JavaScript emit** | ⚠️ Supports ES2021+ only; no downlevel compilation |
| **Decorators (experimentalDecorators)** | ⚠️ Limited / incomplete |
| **Strada API** (Language Service plugins) | ❌ Not supported |

**For Sluice:** Decorators not used ✅. Targeting ES2025 ✅. No Language Service plugins ✅. **Clean adoption.**

### 4.3 The Two-Phase tsgo Adoption Strategy

Because tsgo's **emit pipeline** (turning TypeScript into JavaScript for `dist/`) is still maturing alongside the type checker, the safest migration uses tsgo for type-checking while keeping tsc for JavaScript emit — temporarily.

```
Phase A (immediate): tsgo --noEmit  →  fast type-check in CI
                     tsc --emit     →  still produces dist/

Phase B (when tsgo emit is stable): tsgo everywhere, tsc retired
```

This means **zero disruption** to the current build and dev workflow during Phase A.

### 4.4 tsx Compatibility in TS 7

`tsx` (used for `npm run dev` and `npm run sluice`) transpiles TypeScript via esbuild — it is **not coupled to the TypeScript compiler version**. tsx reads `tsconfig.json` for settings like path aliases and target, but performs its own transpilation.

**Action:** Update `tsx` to its latest version before or alongside the TS 7 migration. Check:
```bash
npm show tsx version
npm show tsx engines
```

### 4.5 vitest Compatibility in TS 7

vitest handles TypeScript via its own Vite-based pipeline. It is TS 7 compatible. No changes to test configuration are expected.

**Action:** Update vitest to latest before TS 7 to pick up any TS 7-aware fixes:
```bash
npm install -D vitest@latest
```

### 4.6 `stableTypeOrdering` in TS 7

In TS 7, `stableTypeOrdering` is no longer a flag — it's the permanent behaviour. If Sluice enabled it in the TS 6 migration (§3.5), any ordering-related errors will already be fixed before reaching TS 7.

---

## 5. Dependency Impact Matrix

| Package | TS 6 Risk | TS 7 Risk | Action |
|---|---|---|---|
| `typescript` | 🔴 Install | 🔴 Install | `npm install -D typescript@6`, then `@7` |
| `@typescript-eslint/parser` | ⚠️ Peer dep | ⚠️ Peer dep | Check peer deps before each upgrade |
| `@typescript-eslint/eslint-plugin` | ⚠️ Peer dep | ⚠️ Peer dep | Same |
| `zod` v3 | 🟢 None | 🟢 Faster | No change |
| `tsx` | 🟢 None | 🟡 Update | Update to latest before TS 7 |
| `vitest` | 🟢 None | 🟡 Update | Update to latest |
| `pino` | 🟢 None | 🟢 None | No change |
| `@duckdb/node-api` | 🟢 None | 🟢 None | Already migrated in Node 24 upgrade (Phase 1, complete) |
| `mssql` | 🟢 None | 🟢 None | No change |
| `axios` | 🟢 None | 🟢 None | No change |
| `dayjs` | 🟢 None | 🟢 None | No change (Temporal is additive, not replacement) |
| `commander` | 🟢 None | 🟢 None | No change |
| `expr-eval` | 🟢 None | 🟢 None | No change |
| `js-yaml` | 🟢 None | 🟢 None | No change |
| `prettier` | 🟢 None | 🟢 None | No change |

---

## 6. tsconfig.json Diff — Before and After

### Current (TypeScript 5 / Node 24)
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",               // assumption — adjust to match actual
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": { "@/*": ["./src/*"] },
    "skipLibCheck": false             // assumption
  }
}
```

### After TypeScript 6 Migration
```jsonc
{
  "compilerOptions": {
    "target": "ES2025",               // ⬆ updated for Node 26
    "lib": ["ES2025"],                // ⬆ added — Temporal types, ES2025 builtins
    "module": "nodenext",             // unchanged ✅
    "moduleResolution": "nodenext",   // unchanged ✅
    "strict": true,                   // still explicit (good practice)
    "exactOptionalPropertyTypes": true,
    "stableTypeOrdering": true,       // ⬆ new — pre-adopts TS 7 type ordering
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": { "@/*": ["./src/*"] }
    // REMOVE if present: "esModuleInterop": false
    // REMOVE if present: "allowSyntheticDefaultImports": false
  }
}
```

### After TypeScript 7 Migration (Phase B — full tsgo emit)
```jsonc
{
  "compilerOptions": {
    "target": "ES2025",
    "lib": ["ES2025"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    // "stableTypeOrdering" is permanent in TS 7 — remove the flag (no-op or error)
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Also update `package.json` scripts in Phase B:
```json
{
  "scripts": {
    "build":      "tsgo -p tsconfig.json",       // was: tsc -p tsconfig.json
    "typecheck":  "tsgo --noEmit",
    "dev":        "tsx watch src/cli.ts",         // unchanged — tsx uses esbuild
    "test":       "vitest run",                   // unchanged
    "test:cov":   "vitest run --coverage"         // unchanged
  }
}
```

---

## 7. Phased Upgrade Path

### Phase 0 — Pre-flight (before installing TS 6)

1. **Check `@typescript-eslint` peer dep compatibility:**
   ```bash
   npm show @typescript-eslint/parser peerDependencies | grep typescript
   # Must include TypeScript 6.x. If not, wait for the update.
   ```

2. **Grep for `assert` import syntax (should find nothing):**
   ```bash
   grep -r "assert {" src/ tests/
   # Expected: no matches. If any found, change to `with { ... }`.
   ```

3. **Grep for any removed tsconfig options in tsconfig.json:**
   ```bash
   grep -E '"esModuleInterop":\s*false|"allowSyntheticDefaultImports":\s*false|"outFile"|moduleResolution.*classic|moduleResolution.*node[^1-9]' tsconfig.json
   # Expected: no matches.
   ```

4. **Create an upgrade branch:**
   ```bash
   git checkout -b feat/typescript6-upgrade
   ```

---

### Phase 1 — Install TypeScript 6 and Fix Build Errors

1. **Install TypeScript 6:**
   ```bash
   npm install -D typescript@6
   npx tsc --version  # should print Version 6.x.x
   ```

2. **Run the automated migration tool** (handles most mechanical changes):
   ```bash
   npx @andrewbranch/ts5to6
   ```
   Review its changes carefully — it handles things like import rewriting for `esModuleInterop` changes.

3. **Update `tsconfig.json`** as per the diff in §6:
   - Change `target` to `"ES2025"`
   - Add `"lib": ["ES2025"]`
   - Add `"stableTypeOrdering": true`
   - Remove `esModuleInterop: false` / `allowSyntheticDefaultImports: false` if present

4. **Run the type checker:**
   ```bash
   npx tsc --noEmit
   ```
   Collect all errors. Do NOT proceed to build until these are fixed.

5. **Work through type errors systematically by file.** Priority order:
   - `src/config/` — foundation, must be clean first
   - `src/staging/store.ts` — core to all other modules
   - `src/dq/` — engine and rules
   - `src/transform/` — engine, expressions, lookups
   - `src/adapters/` — source and target adapters
   - `src/runner.ts` — wires everything together
   - `src/cli.ts` — outermost shell

6. **Rules for fixing type errors:**
   - **Use `unknown` + type guards**, not `any`
   - **Narrow explicitly** — prefer `if (typeof x === 'string')` patterns
   - **Never suppress** with `// @ts-ignore` — each error must be genuinely resolved
   - **Align with existing error hierarchy** in `src/utils/errors.ts`

7. **Build and run tests:**
   ```bash
   npm run build
   npm run lint
   npm test
   ```
   All must pass. If `@typescript-eslint` emits new TS 6-specific lint errors, fix them.

8. **Commit Phase 1:**
   ```bash
   git add -A
   git commit -m "feat: upgrade TypeScript 5 → 6"
   ```

---

### Phase 2 — Enable `stableTypeOrdering` and Verify

`stableTypeOrdering` was added in Phase 1 tsconfig but may surface additional ordering-related type errors (usually in union type discrimination).

1. Confirm the flag is in `tsconfig.json`:
   ```jsonc
   "stableTypeOrdering": true
   ```

2. Run:
   ```bash
   npx tsc --noEmit
   ```
   Fix any new errors. These are typically in union type switches or discriminated unions — the pattern used extensively in `FieldType` and `CheckType` handling.

3. Run tests again:
   ```bash
   npm test
   ```

---

### Phase 3 — CI Update for TypeScript 6

Update `.github/workflows/ci.yml`. The build step already uses `npm run build` (which calls `tsc`) — no change needed. However, add an explicit type-check step:

```yaml
- name: Type check
  run: npx tsc --noEmit

- name: Build
  run: npm run build

- name: Test
  run: npm run test:cov
```

Merge `feat/typescript6-upgrade` to `main`. TS 6 migration complete.

---

### Phase 4 — Introduce tsgo for Type Checking (TS 7, Phase A)

This phase adds tsgo as a **parallel type-checker** without changing the build or dev workflow.

1. **Create a new branch:**
   ```bash
   git checkout -b feat/typescript7-tsgo
   ```

2. **Install the TypeScript 7 native preview package:**
   ```bash
   npm install -D @typescript/native-preview
   # or, when TypeScript 7 is the default package:
   npm install -D typescript@7
   ```

3. **Run tsgo type-check against Sluice source:**
   ```bash
   npx tsgo --noEmit
   ```
   The 2% of TS 6 code that tsgo handles differently may surface a small number of errors. Fix them — they represent genuine type improvements.

4. **Add tsgo type-check to `package.json`:**
   ```json
   {
     "scripts": {
       "typecheck:ts6":  "tsc --noEmit",
       "typecheck:ts7":  "tsgo --noEmit",
       "typecheck":      "npm run typecheck:ts7"
     }
   }
   ```

5. **Add tsgo job to CI** (runs in parallel with the existing tsc build job):
   ```yaml
   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '26', cache: 'npm' }
         - run: npm ci
         - run: npm run lint
         - run: npm run build           # still uses tsc 6 for emit
         - run: npm run typecheck:ts7   # tsgo — fast type check
         - run: npm run test:cov
   ```

   With tsgo, the type-check step will complete in **under 1 second** for the Sluice codebase.

6. **Commit Phase 4:**
   ```bash
   git commit -m "feat: add TypeScript 7 (tsgo) type-checking to CI"
   ```

---

### Phase 5 — Full tsgo Emit Migration (TS 7, Phase B)

**Timing:** Do this when the tsgo emit pipeline is confirmed stable for `module: nodenext`. Monitor the [TypeScript Go GitHub repo](https://github.com/microsoft/typescript-go) for emit completion announcements. Expected: mid-to-late 2026.

**Gate condition:** Before proceeding, verify:
```bash
npx tsgo -p tsconfig.json --listEmittedFiles 2>&1 | head -20
# Should produce a list of .js files in dist/ without errors
```

1. **Switch build scripts:**
   ```json
   {
     "scripts": {
       "build":     "tsgo -p tsconfig.json",
       "typecheck": "tsgo --noEmit"
     }
   }
   ```

2. **Remove `stableTypeOrdering`** from `tsconfig.json` (it's now the permanent default; keeping it may cause a warning):
   ```bash
   # Remove the stableTypeOrdering line from tsconfig.json
   ```

3. **Update `typescript` package** to v7 if not already:
   ```bash
   npm install -D typescript@7
   ```

4. **Full test:**
   ```bash
   npm run build
   npm run lint
   npm test
   ```
   The build will be noticeably faster. Run `time npm run build` and compare with `time npx tsc -p tsconfig.json`.

5. **Verify dist/ output** is functionally identical to the tsc-generated output:
   ```bash
   # Run both and compare critical path files
   npx tsc -p tsconfig.json --outDir dist-tsc/
   tsgo -p tsconfig.json --outDir dist-tsgo/
   diff -r dist-tsc/ dist-tsgo/
   ```
   Minor cosmetic differences are expected; functional differences must be investigated.

6. **Remove tsc from CI** (it's no longer used):
   ```yaml
   # Remove from package.json devDependencies:
   # "typescript": "7.x"  (tsgo IS typescript 7 — the package ships both binaries)
   ```

7. **Commit Phase 5:**
   ```bash
   git commit -m "feat: migrate build to TypeScript 7 native compiler (tsgo)"
   ```

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| New TS 6 inference errors in `transform/engine.ts` | High | Medium — type errors to fix | Budget 2–4 hours; use `unknown` + narrowing |
| `@typescript-eslint` not yet supporting TS 6 | Low | Low — CI lint fails | Wait for `@typescript-eslint` release (usually < 2 weeks) |
| tsgo emits subtly different JS in Phase 5 | Low | Medium — runtime behaviour | `diff -r dist-tsc/ dist-tsgo/` gate in Phase 5 |
| tsgo emit for `nodenext` module not stable | Medium (currently) | Low — blocked Phase 5 only | Phase A/B split means this doesn't block anything |
| `stableTypeOrdering` surfaces union type errors | Medium | Low — small number of fixes | Fix in Phase 2 before merging |
| tsx not updated for TS 6 type syntax | Low | Low — dev only, not build | Update tsx before Phase 1 |

---

## 9. Summary Timeline

```
Prerequisite:    Node.js 26 upgrade complete
                     ↓
Phase 0:         Pre-flight checks (grep for removed options, peer dep check)
                     ↓  (1 hour)
Phase 1:         Install TS 6, run ts5to6 tool, fix type errors, verify build + tests
                     ↓  (1–3 hours depending on error count)
Phase 2:         stableTypeOrdering errors fixed
                     ↓  (0.5 hours)
Phase 3:         CI updated for TS 6 → merge to main
                     ↓  (0.5 hours)
                 ─── TS 6 COMPLETE ───
                     ↓
Phase 4:         tsgo installed, running in CI as parallel type-checker
                     ↓  (1 hour)
                 ─── TS 7 PHASE A COMPLETE ───
                     ↓  (wait for tsgo emit stability)
Phase 5:         tsgo takes over full build → tsc retired
                     ↓  (1 hour + diff validation)
                 ─── TS 7 FULLY ADOPTED ───
```

**Estimated total effort:**  
- TS 5 → 6: **3–5 hours** (dominated by type error fixes)  
- TS 6 → 7 Phase A: **1 hour** (mostly CI config)  
- TS 6 → 7 Phase B: **1–2 hours** (when tsgo emit is ready)  

---

## 10. Key References

- [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)
- [TypeScript 6.0 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- [TypeScript 5.x to 6.0 Migration Guide (privatenumber/gist)](https://gist.github.com/privatenumber/3d2e80da28f84ee30b77d53e1693378f)
- [Announcing TypeScript 7.0 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/)
- [TypeScript Go Repo (microsoft/typescript-go)](https://github.com/microsoft/typescript-go)
- [TypeScript Native Preview npm package](https://www.npmjs.com/package/@typescript/native-preview)
- [Progress on TypeScript 7 — December 2025](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)

---

*This document assumes the Node.js 24 upgrade (including the `@duckdb/node-api` migration) is complete — Phase 1 of the [master implementation plan](SLUICE-IMPLEMENTATION-PLAN.md) shipped on 3 May 2026 (PR #8). The DuckDB store rewrite was done under TypeScript 5; the TypeScript 6 migration is applied on top of that clean baseline.*
