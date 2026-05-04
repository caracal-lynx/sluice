# Sluice — Phase 11: TypeScript v7 (`tsgo`) Spec

> 🟡 **Status: Phase 11a is unblocked once Phase 2 (TypeScript v6) lands. Phase 11b is deferred until `tsgo` emit output is byte-stable (estimated mid/late 2026).**
>
> **Owner:** Caracal Lynx Ltd. · Michael Scott
> **Estimated effort:** Phase 11a ≈ 1 hour. Phase 11b ≈ 1–2 hours.
> **Master plan reference:** [SLUICE-IMPLEMENTATION-PLAN.md §15](./SLUICE-IMPLEMENTATION-PLAN.md#15-phase-11--typescript-v7)

---

## Context

TypeScript 7 is a from-scratch Go rewrite of the TypeScript compiler — the project formerly known as `tsgo`, distributed as `@typescript/native-preview`. The end-user benefit is roughly **10× faster type-checking**: Sluice's ~50 source files type-check in well under a second instead of several seconds.

Sluice is an unusually good candidate for `tsgo`:

- No decorators (none in the codebase)
- No Language Service plugins
- Pure ESM with `module: "nodenext"`
- Small surface area (~50 source files)
- Already targets a modern lib (ES2025 after Phase 2)

The transition is split into **two stages, deliberately decoupled**:

| Stage | Scope | Risk profile |
|---|---|---|
| **Phase 11a** | Add `tsgo --noEmit` to CI alongside `tsc`. Type-check only — no emit. | Zero risk to the build. CI gets a free fast-feedback signal. |
| **Phase 11b** | Replace `tsc` with `tsgo` for both type-check **and** build emit. Retire the `typescript` package. | Real risk: `tsgo` emit must be byte-stable vs. `tsc` emit. Defer until verifiable. |

Running 11a first means the production type-checker (`tsc`) stays authoritative while we build confidence in `tsgo`'s judgements. When `tsgo` emit reaches stability, 11b is a small, low-risk swap.

---

## Goals & non-goals

### Goals

- **Phase 11a:** `tsgo --noEmit` runs in CI on every PR, side-by-side with `tsc --noEmit`. Initially `continue-on-error: true` (CI doesn't fail on tsgo output); promoted to required once stable.
- **Phase 11b (when triggered):** `tsgo` is the only compiler. `dist/` output is byte-for-byte equivalent to the previous `tsc` build. The `typescript` npm dep is removed; only `@typescript/native-preview` remains.
- Document any divergence between `tsc` and `tsgo` errors discovered during 11a, so 11b is predictable.

### Non-goals

- Adopting any `tsgo`-only experimental features (`--build` modes, new flags) — stick to the parity surface during 11.
- Switching to `tsgo` before Phase 2 (TS 6) lands — `tsgo` targets TS 6+ semantics; running it against TS 5.x is wasted effort.
- Waiting for the official TypeScript 7.0 stable release tag before doing 11a — `@typescript/native-preview` is the supported preview channel and the type-check-only mode is already stable enough for parallel CI use.

---

## Prerequisites (must be true before starting either stage)

| # | Prerequisite | Stage | Verify with |
|---|---|---|---|
| 1 | Phase 2 (TypeScript v6) merged to master; `package.json` `"typescript": "^6.x"` | 11a, 11b | `jq -r '.devDependencies.typescript' package.json` |
| 2 | All Vitest suites green on TS 6 | 11a, 11b | `npm test` |
| 3 | `tsc --noEmit` zero errors on TS 6 | 11a, 11b | `npx tsc --noEmit` |
| 4 | (11b only) `tsgo` emit declared stable by the TypeScript team **OR** demonstrated byte-stability across at least one tagged release | 11b | TypeScript team blog / GitHub release notes |

---

## Phase 11a — Parallel type-check in CI

### What changes

| File | Change |
|---|---|
| `package.json` | Add `@typescript/native-preview` to `devDependencies`. Add a `typecheck:tsgo` script. |
| `.github/workflows/ci.yml` | Add a "Type-check (tsgo)" step alongside the existing build/test steps. |

### Implementation

**1. Install `@typescript/native-preview`:**

```bash
npm install -D @typescript/native-preview
```

**2. Add a script to `package.json`:**

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "typecheck:tsgo": "tsgo --noEmit"
  }
}
```

**3. Add the CI step to `.github/workflows/ci.yml`:**

```yaml
- name: Type-check (tsgo, parallel)
  run: npm run typecheck:tsgo
  continue-on-error: true   # Promote to required once tsgo output is clean
```

Place this step *after* `npm test` so the existing pipeline isn't blocked. The `continue-on-error: true` flag means the workflow stays green even if `tsgo` reports issues — the goal of 11a is to surface differences, not to block on them yet.

### Iteration loop

`tsc` and `tsgo` may report different things during the preview period. The expected workflow over a few weeks:

1. Open the CI logs after each PR; note any `tsgo` errors that `tsc` did not report (or vice versa).
2. For each divergence, decide:
   - **`tsgo` is correct, `tsc` missed it** → fix the code; both compilers will agree afterwards.
   - **`tsc` is correct, `tsgo` is buggy** → file a `microsoft/typescript-go` issue; document the workaround in this spec.
   - **Both correct, semantic difference** → adjust tsconfig until they agree.
3. When `tsgo` runs cleanly for ~10 consecutive PRs, **remove `continue-on-error: true`** and promote it to a required check.

### Phase 11a — Step-by-step checklist

1. Verify Prerequisites #1–#3.
2. `npm install -D @typescript/native-preview`.
3. Add the `typecheck:tsgo` script to `package.json`.
4. Add the parallel CI step with `continue-on-error: true`.
5. Open a PR; merge once the existing checks pass and the new step appears in the workflow output.
6. **Soak period:** monitor for ~2 weeks of normal PRs. Log any divergences in the open-questions section of this doc.
7. When clean, remove `continue-on-error: true`; merge that as a separate PR.

### Phase 11a — Done criteria

- [ ] `@typescript/native-preview` in `devDependencies`
- [ ] `typecheck:tsgo` script in `package.json`
- [ ] CI runs `tsgo --noEmit` on every PR
- [ ] After soak period: `continue-on-error` removed; tsgo step is required
- [ ] Any tsc/tsgo divergences documented (none expected for Sluice's surface)

---

## Phase 11b — Full compiler switch (deferred)

> ⏸️ **DO NOT START 11b until the trigger conditions in Prerequisite #4 are met.** As of this writing (2026-05), `tsgo` emit is preview-quality. The TypeScript team has stated that emit byte-stability vs. `tsc` will be a 7.0 release goal. Watch the official blog for the green light.

### Trigger conditions

Phase 11b is unblocked when **any** of the following is true:

- TypeScript team publicly states that `tsgo` emit output is byte-stable for `module: nodenext` ES2025 targets.
- TypeScript 7.0 stable releases (the rewrite is not in "preview" any more).
- We can demonstrate, on a representative sample of Sluice source, that `tsc` and `tsgo` produce byte-identical `dist/` output across at least three releases.

Until any of those is true, **stay on 11a**. The CI speedup is the main win; 11a delivers it for free with zero risk.

### What changes (when 11b runs)

| File | Change |
|---|---|
| `package.json` | Replace `tsc` with `tsgo` in `build` script. Remove the `typescript` dep. Keep `@typescript/native-preview`. |
| `.github/workflows/ci.yml` | Drop the parallel comparison; `tsgo` is now authoritative. |
| `tsconfig.json` | Likely no changes (Sluice is already on `module: nodenext` with `strict: true`). Verify against the latest `tsgo` compatibility notes at switch time. |

### Implementation

**1. Update `package.json` build script:**

```json
{
  "scripts": {
    "build": "tsgo -p tsconfig.json",
    "typecheck": "tsgo --noEmit"
  }
}
```

**2. Remove the `typescript` dep:**

```bash
npm uninstall typescript
# Verify no transitive dep still pulls it in:
npm ls typescript
```

If something still depends on `typescript` (e.g. `typescript-eslint`), keep it as a transitive — but the project no longer depends on it directly.

**3. Update CI:**

Remove the `Type-check (tsgo, parallel)` step (no longer needed); the `npm run build` step now runs `tsgo` natively.

### Validation strategy — byte-equal `dist/`

The riskiest part of 11b is that emit output may differ subtly between `tsc` and `tsgo` even when type-checking is identical. The validation:

1. Before the switch, build with the current `tsc` setup and snapshot `dist/` (e.g. `cp -r dist/ /tmp/dist-tsc`).
2. Switch the build script to `tsgo`. `npm run build`.
3. `diff -r /tmp/dist-tsc dist/` — **expect zero differences**.
4. If differences exist, investigate:
   - Whitespace / source-map differences are cosmetic but worth noting.
   - Output that *executes* differently is a hard blocker — file an upstream issue, do **not** merge 11b.
5. Run full test suite against the `tsgo`-built `dist/`: `npm test`.

### Phase 11b — Step-by-step checklist

1. Verify Prerequisite #4 (trigger conditions met).
2. Snapshot the current `tsc`-built `dist/`: `npm run build && cp -r dist/ /tmp/dist-tsc-baseline`.
3. Update `package.json`: replace `tsc` with `tsgo` in `build`; consolidate `typecheck` → `typecheck:tsgo` if separate.
4. `npm uninstall typescript` (if no transitive dependency requires it directly).
5. `npm run build` and diff vs. baseline: `diff -r /tmp/dist-tsc-baseline dist/`. Expect no differences.
6. `npm test` — all suites pass against the new `dist/`.
7. Remove the parallel CI step.
8. Open a PR titled "Phase 11b: switch to tsgo". Merge.

### Phase 11b — Done criteria

- [ ] `package.json` `build` script uses `tsgo`
- [ ] `typescript` package no longer a direct dep
- [ ] `dist/` byte-equal to last `tsc`-built version (or differences fully understood and documented)
- [ ] All Vitest suites passing against `tsgo`-built `dist/`
- [ ] CI no longer runs the parallel `tsc` + `tsgo` comparison
- [ ] Sub-second type-check confirmed locally and in CI

---

## Open questions / risks

| # | Item | Risk | Mitigation |
|---|---|---|---|
| Q1 | `tsgo` emit not byte-stable when we want to switch | Medium | Phase 11b is deferred until verifiable. Phase 11a doesn't depend on emit at all. |
| Q2 | TypeScript team renames the package or scope before 7.0 GA | Low | Pin to `@typescript/native-preview` for 11a; revisit at 11b time. |
| Q3 | `typescript-eslint` requires `typescript` as a peer dep | Low | Keep `typescript` only if peer-required at 11b time; the goal is "no direct dep", not "absent from `node_modules`". |
| Q4 | New errors surface during 11a soak that block real PRs | Low | `continue-on-error: true` exists exactly to absorb this. Stay in 11a soak until clean. |
| Q5 | `tsgo --build` (composite project mode) behaves differently from `tsc --build` | N/A | Sluice doesn't use composite projects. |
| Q6 | Phase 10 (Node 26) interaction | Low | Phase 10 doesn't change TypeScript at all. The two phases are independent. |

---

## Document inventory updates required

When this spec is created, update [SLUICE-IMPLEMENTATION-PLAN.md §16 Document Inventory](./SLUICE-IMPLEMENTATION-PLAN.md#16-document-inventory) to add a row for this file. Also update §15 of the master plan to reference this spec instead of pointing at the (now misleading) `docs/PHASE-02-typescript-v6-upgrade.md` — Phase 11 deserves its own doc rather than being a footnote inside Phase 2's spec.

---

*Caracal Lynx Ltd. — SC826823 — Gretna, Scotland*
*"Clean data flows through."*
