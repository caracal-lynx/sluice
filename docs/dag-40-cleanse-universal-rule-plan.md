# DAG-40 — `cleanse:` universal composition rule — implementation plan

> **Status:** Plan (no code written yet). Tracking issue: **DAG-137**
> (implementation). Decision record: **DAG-40** (closed). Companion to the ADR
> that will land in **this (`sluice`) repo** (`docs/adr/`) — `cleanse:` is a
> sluice pipeline-YAML semantic, and sluice owns that contract. Source finding:
> F5 / P9 in `mcp-improvement-plan-2026-05-19.md` (sluice-mcp repo, `docs/`).
>
> **This plan lives in the core `@caracal-lynx/sluice` repo because the primary
> code change is here** (`src/transform/engine.ts`). sluice-mcp only consumes the
> new release and reverts interim skill guidance (§9).

---

## 1. The rule

> **If `cleanse:` is set on a field mapping, it always runs. It is the last
> string-level step before the field's output — which for the scalar coercion
> types means immediately _before_ coercion, and for every other value-producing
> type means _after_ default/optional resolution, on the resolved value.**

One sentence, no exceptions. Setting `cleanse:` is never silently ignored again.

---

## 2. Current state (the problem)

All transform logic is in `src/transform/engine.ts::applyFieldMapping`.
sluice-mcp only _enumerates_ cleanse ops (`list_transform_ops` →
`BUILTIN_CLEANSE_OPS`); it does not apply them.

| `type`                                       | cleanse honoured today?                 | position today                   |
| -------------------------------------------- | --------------------------------------- | -------------------------------- |
| `unmapped`                                   | n/a (emits placeholder, short-circuits) | —                                |
| `constant`                                   | **dropped**                             | —                                |
| `expression`                                 | **dropped**                             | —                                |
| `custom`                                     | **dropped** ← F5 / P9                   | —                                |
| `lookup`                                     | **dropped**                             | —                                |
| `concat`                                     | yes                                     | cleanse **before** default check |
| `string`/`number`/`decimal`/`boolean`/`date` | yes                                     | default → cleanse → coerce       |

### Two latent inconsistencies this plan removes

1. **Four silent drops.** `constant`, `expression`, `custom`, `lookup` accept
   `cleanse:` in the Zod schema (`FieldMappingSchema` has no type-gating
   refinement) but the engine ignores it. No error, wrong output.
2. **Ordering wart between the two honoured paths.** `concat` cleanses
   _before_ the default check; scalars cleanse _after_ default substitution.
   Adding cleanse to the dropped types without picking a canonical order would
   introduce a _third_ ordering.

---

## 3. Target state

Canonical position (locked decision — see §4): **default/optional resolves
first, then cleanse, then final coercion/null-handling.**

| `type`       | new behaviour                                                                            | change required                                       |
| ------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `unmapped`   | unchanged — placeholder short-circuit, cleanse never reached                             | none                                                  |
| `constant`   | `value ?? null` → **cleanse** → return                                                   | **add cleanse**                                       |
| `lookup`     | resolve → default/optional/throw → **cleanse** → return                                  | **add cleanse**                                       |
| `custom`     | input default/optional → `plugin.apply` → result default/optional → **cleanse** → return | **add cleanse**                                       |
| `concat`     | join → **default check → cleanse** → `String()`                                          | **move cleanse** (after default) — _behaviour change_ |
| scalars      | default → **cleanse** → coerce                                                           | none (already canonical)                              |
| `expression` | evaluate → **cleanse** → return                                                          | **add cleanse**                                       |

Resulting model: cleanse is a single post-resolution string step that every
value-producing type funnels through.

---

## 4. Locked decisions

| Decision               | Choice                                                                                                         | Rationale                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Scope of types**     | **All value-producing types** — `custom` + `lookup` + `constant` + `expression`; `concat` + scalars reconciled | One exception-free rule. `expression` is wired here too (§5.6).                                                                   |
| **Ordering**           | **Reconcile** to one canonical position                                                                        | Eliminates the concat-vs-scalar wart instead of adding a third order.                                                             |
| **cleanse vs default** | **Default resolves, then cleanse**                                                                             | Mirrors current scalar semantics; guarantees the _output_ is always cleansed (e.g. `truncate:10` holds even for a default value). |
| **Schema**             | No Zod refinement (compose, not reject)                                                                        | `cleanse:` stays universally allowed on all types.                                                                                |

### Expression is wired in this change

`expression` follows the identical position (`evaluate → cleanse → return`) and
is implemented here (§5.6) — the rule is literally exception-free across all ten
field types. This is **independent of DAG-39**: DAG-39 decides whether
`expression` is a feature users should _use or avoid_; this change only ensures
that _if_ `cleanse:` is set on an expression field, it composes like every other
type. Note the new behaviour in the core CHANGELOG and the ADR.

---

## 5. Code changes — core `@caracal-lynx/sluice`

File: `src/transform/engine.ts`, function `applyFieldMapping`
(currently lines ~111–275).

### 5.0 Shared helper

Introduce one helper near the top of the module:

```ts
/** Universal cleanse step: the last string-level transform before output.
 *  No-op when no cleanse spec is set; applyCleanse already passes null/undefined through. */
function applyCleanseStep(field: FieldMapping, value: unknown): unknown {
  return field.cleanse ? applyCleanse(value, field.cleanse) : value;
}
```

Every value-producing branch routes its resolved value through this helper at
the canonical point.

### 5.1 `constant` (currently line ~127)

```ts
// before
if (field.type === "constant") {
  return field.value ?? null;
}
// after
if (field.type === "constant") {
  return applyCleanseStep(field, field.value ?? null);
}
```

### 5.2 `custom` (currently lines ~136–169)

Restructure so a single `result` funnels through one cleanse step. Cleanse
applies to the plugin output **and** to any default/optional substitution
(default resolves, then cleanse):

```ts
if (field.type === "custom") {
  if (!field.customOp) throw new TransformError(`custom field "${field.to}" requires 'customOp'`);
  const plugin = transforms.get(field.customOp);
  if (!plugin)
    throw new TransformError(`No custom transform plugin registered for "${field.customOp}"`);

  const value = typeof field.from === "string" ? row[field.from] : undefined;
  let result: unknown;

  if (
    (value === null || value === undefined || value === "") &&
    field.default !== undefined &&
    field.default !== null
  ) {
    result = field.default; // pre-plugin default
  } else if ((value === null || value === undefined || value === "") && field.optional) {
    result = null; // pre-plugin optional
  } else {
    result = plugin.apply(value, row, field as unknown as CustomFieldMapping);
    if (result === null || result === undefined) {
      // post-plugin default/optional
      if (field.default !== undefined && field.default !== null) result = field.default;
      else if (field.optional) result = null;
    }
  }

  return applyCleanseStep(field, result) ?? null;
}
```

> Note: this also funnels the _pre-plugin_ default through cleanse — uniform
> with the rule. Defaults are usually pre-cleansed, so this is a no-op in
> practice but keeps the rule exception-free.

### 5.3 `concat` (currently lines ~172–187) — **behaviour change**

Move cleanse to **after** the default check:

```ts
if (field.type === "concat") {
  if (!Array.isArray(field.from))
    throw new TransformError(`concat field "${field.to}" requires array 'from'`);
  const sep = field.separator ?? " ";
  const parts = field.from.map((f) => {
    const v = row[f];
    return v === null || v === undefined ? "" : String(v);
  });
  let value: unknown = parts.join(sep);
  if (value === null || value === undefined || value === "") {
    value = applyDefaultOrOptional(field, value); // default first
  }
  value = applyCleanseStep(field, value); // then cleanse
  if (value === null || value === undefined) return null;
  return String(value);
}
```

**Impact:** a `concat` field that joins to `""` and relied on
`cleanse: nullIfEmpty` to trigger `default` will no longer do so — `default`
is consulted first now. This is the one existing-pipeline-visible change;
it must be called out in the ADR consequences and the core CHANGELOG.

### 5.4 `lookup` (currently lines ~190–205)

Resolve to a single value, then cleanse before return:

```ts
if (field.type === "lookup") {
  if (typeof field.from !== "string")
    throw new TransformError(`lookup field "${field.to}" requires string 'from'`);
  if (!field.lookup) throw new TransformError(`lookup field "${field.to}" requires 'lookup'`);
  const sourceValue = row[field.from];
  const resolved = lookups.resolve(field.lookup, sourceValue);
  let value: unknown;
  if (resolved !== undefined) value = resolved;
  else if (field.default !== undefined && field.default !== null) value = field.default;
  else if (field.optional) value = null;
  else
    throw new TransformError(
      `lookup "${field.lookup}" missed value "${String(sourceValue)}" for field "${field.to}"`,
    );
  return applyCleanseStep(field, value);
}
```

### 5.5 Scalars (currently lines ~207–274) — **route through the helper (decided)**

Already canonical (default → cleanse at line ~228 → coerce), so **no behaviour
change**. Decision: route scalar through the shared helper so all ten
value-producing types call one cleanse step — the rule is exception-free in code,
not just in prose.

```ts
// before (line ~228)
if (field.cleanse && value !== null && value !== undefined) {
  value = applyCleanse(value, field.cleanse);
}
if (value === null || value === undefined) return null;
// after
value = applyCleanseStep(field, value);
if (value === null || value === undefined) return null;
```

The dropped null-guard is redundant — `applyCleanse` already short-circuits
null/undefined. Output is byte-identical.

**Mandatory guard test (placement):** the helper call MUST stay _after_ default
substitution and _before_ the null-check + coercion switch. Pin this with a
test (see §6.6) so a future edit can't move cleanse past coercion.

### 5.6 `expression` (currently lines ~130–135)

```ts
// before
if (field.type === "expression") {
  if (typeof field.value !== "string")
    throw new TransformError(`expression field "${field.to}" requires string 'value'`);
  return expr.evaluate(field.value, row);
}
// after
if (field.type === "expression") {
  if (typeof field.value !== "string")
    throw new TransformError(`expression field "${field.to}" requires string 'value'`);
  return applyCleanseStep(field, expr.evaluate(field.value, row));
}
```

Independent of DAG-39 (which governs whether `expression` should be used at
all) — this only guarantees `cleanse:` composes when present.

---

## 6. Tests — core `@caracal-lynx/sluice`

Directory: `tests/unit/transform/`.

1. **`custom.test.ts`** — add: `type: custom` + `cleanse: uppercase` composes
   (the F5 regression); plugin returns lowercase → output uppercased. Add a
   `cleanse` + `default` case (default value is cleansed). Add a
   `nullIfEmpty`-produces-null case.
2. **`engine.test.ts`** — add `lookup` + cleanse and `constant` + cleanse cases.
3. **`cleanse.test.ts`** — unchanged (op-level unit tests still hold).
4. **concat ordering** — grep existing tests for `concat` + `cleanse`; update
   any assertion that depends on the old cleanse-before-default order. Add a
   test pinning the **new** order (join `""` + `default` + `nullIfEmpty` →
   resolves to default, not null).
5. **Scalar regression** — confirm existing scalar cleanse tests still pass
   unchanged.
6. **Scalar placement guard (new)** — pin that cleanse runs _before_ coercion:
   - `cleanse: stripNonNumeric` + `type: number` on `"$1,200"` → `1200`
     (would throw "not a number" if cleanse ran after coercion).
   - `cleanse: padStart:5:0` + `type: string` → confirms string-side ordering.
     These tests fail if a future edit moves the `applyCleanseStep` call past the
     coercion switch.

Run: `pnpm --filter @caracal-lynx/sluice test` (confirm task name in core
`package.json`).

---

## 7. Docs — core `@caracal-lynx/sluice`

| File                                                     | Change                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| `docs-site/src/content/docs/reference/transforms.mdx`    | State the universal rule; per-type position table.              |
| `docs-site/src/content/docs/reference/pipeline-yaml.mdx` | Note `cleanse:` composes with all value-producing types.        |
| `docs/PLUGINS.md` / `PLUGINS.md`                         | Add: `cleanse:` is applied _after_ a custom plugin returns.     |
| `CHANGELOG.md` + changeset                               | Behaviour change entry (esp. concat reordering).                |
| `CLAUDE.md` cleanse table                                | Mention universal application if the table implies scalar-only. |

---

## 8. Versioning / release — core

- Behaviour change (concat reordering + newly-applied cleanse on
  constant/lookup/custom) → **minor version bump** at minimum.
- Add a **changeset** (`.changeset/*.md`) describing the change; the
  "Version Packages" PR is **never auto-merged** — ask before merging.
- CHANGELOG must explicitly flag the concat reordering as potentially
  output-changing for existing pipelines.

---

## 9. Follow-ups — sluice-mcp repo

1. **Bump** the `@caracal-lynx/sluice` dependency to the released version.
2. **Revert interim guidance.** The P9 interim text — _"`cleanse:` is not
   applied when `type: custom` is used"_ — is now false. Remove/replace wherever
   it appears (skill drafts, sluice-mcp docs).
3. **DAG-47** (blocked by DAG-40): its topic (7) must now _document the
   composition behaviour_ (cleanse composes universally; applied after the
   plugin returns) rather than warn that cleanse is ignored. Topic (6)
   expression note stays gated on DAG-39.
4. **`list_transform_ops`** description (sluice-mcp `src/tools/definitions.ts`):
   optional — add a line that `cleanse:` composes with every field type.
5. Confirm no sluice-mcp code applies/relies-on the old drop behaviour
   (none found — sluice-mcp only enumerates ops).

---

## 10. The ADR

Write `docs/adr/NNNN-cleanse-composition.md` **in this (`sluice`) repo**
(establishes its `docs/adr/` directory). Record:

- **Decision:** compose — universal rule (§1).
- **Options rejected:** reject-at-schema (fail fast), document-as-intentional.
- **Consequences:** concat reordering is output-visible; `expression` now also
  composes cleanse (independent of DAG-39); `constant` + cleanse is
  permitted-but-rarely-useful (allowed for rule-uniformity).
- Link the CHANGELOG entry and this plan.

**ADR home (decided):** `sluice/docs/adr/`. `cleanse:` is a sluice
pipeline-YAML semantic, and sluice owns the pipeline-YAML contract — so the ADR
homes with the code and the CHANGELOG, in this repo. Downstream consumers of
the pipeline YAML (dredge `emit`, sluice-mcp's authoring skill) follow it.
Family-spanning decisions live in `DATA-GUBBINS-VISION.md` §8; the _Frictionless
Data Package_ interchange contract (a separate concern) lives in
`@caracal-lynx/frictionless-schema`. This decision is neither — it's
sluice-local.

---

## 11. Step-by-step to-do (implementation order)

1. [x] Branch core: `feature/dag-137-implement-universal-cleanse-composition-rule-core-engine-adr` in `C:\repos\sluice`.
2. [ ] Add `applyCleanseStep` helper (§5.0).
3. [ ] Wire `constant` (§5.1).
4. [ ] Restructure `custom` to funnel through one cleanse step (§5.2).
5. [ ] Move `concat` cleanse after the default check (§5.3).
6. [ ] Wire `lookup` (§5.4).
7. [ ] Wire `expression` (§5.6).
8. [ ] Route scalar cleanse through the helper (§5.5) + add the placement guard test (§6.6).
9. [ ] Add/extend tests (§6), incl. `expression` + cleanse; grep for existing concat+cleanse assertions and update.
10. [ ] Run the full core unit + integration suite; fix fallout.
11. [ ] Update core docs (§7).
12. [ ] Add changeset + CHANGELOG entry flagging the concat behaviour change + new expression/lookup/constant composition (§8).
13. [ ] Open core PR; do **not** merge the Version Packages PR without asking.
14. [ ] Write the ADR in `sluice/docs/adr/` (§10).
15. [ ] After core release: bump dep in sluice-mcp, revert interim guidance, update DAG-47 content (§9).

---

## 12. Risks & rollback

- **Concat reordering** is the only behaviour change visible to existing
  pipelines. Mitigation: explicit CHANGELOG flag + ADR consequence note; the
  affected pattern (concat→`""`→`nullIfEmpty`→default) is narrow.
- **Custom restructure** changes control flow around default/optional; the
  test matrix (§6) must cover empty-input default, post-plugin null default,
  and cleanse-to-null to prevent regressions.
- **Rollback:** the change is additive per-type plus one reorder; reverting the
  core commit restores prior behaviour. No data migration, no schema change.
