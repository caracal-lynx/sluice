# Sluice — Plugin Author Guide

Sluice's pipeline configs are intentionally constrained — the schema is fixed, the field types are enumerated, the DQ check types are an explicit list. That keeps configs readable and reviewable. But every real migration eventually needs _something_ the built-ins don't cover: a regex pattern that only makes sense for one client's data, a date format only one ERP uses, a merge strategy with custom precedence rules.

Plugins fill that gap without forcing you to fork the engine. Sluice exposes a **three-tier extension model** that scales from "I just want a reusable composite rule for this client" to "I want to publish a paid adapter package on npm."

---

## The three tiers at a glance

| Tier                              | What it is                                                                              | Where it lives                                        | Who writes it          | Distribution                  |
| --------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------- | ----------------------------- |
| **Tier 1 — Composite YAML rules** | A named bundle of built-in DQ checks                                                    | YAML files in your project                            | Anyone — no code       | In your repo                  |
| **Tier 2 — File-based plugins**   | TypeScript module exporting a `RulePlugin`, `TransformPlugin`, or `MergeStrategyPlugin` | `plugins/*.{rule,transform,merge}.ts` in your project | Anyone with TypeScript | In your repo                  |
| **Tier 3 — npm package plugins**  | A published npm package with a `register()` function                                    | Anywhere installable via `npm install`                | Plugin authors         | npmjs.com (public or private) |

You can mix tiers freely — a single pipeline can pull composite rules (Tier 1), a local dev's file plugin (Tier 2), and an installed npm rule pack (Tier 3) all at once.

---

## Tier 1 — Composite YAML rules

A composite rule is a **named bundle of built-in checks** that you reference in pipeline DQ rules by a single ID. Useful when the same combination of checks (e.g., `notNull` + `pattern` + `maxLength` for an internal style number) repeats across many fields and many pipelines.

### Library file

Composite rules live in a YAML file referenced by `dq.rulesFile`. Convention: `shared/rules.yaml` at the repo root.

```yaml
# shared/rules.yaml
version: "1.0"

rules:
  - id: ukVatNumber
    description: UK VAT registration number — format only (existence check is a separate concern)
    checks:
      - { type: pattern, value: "^GB([0-9]{9}|[0-9]{12}|(GD|HA)[0-9]{3})$", severity: warning }

  - id: positivePrice
    description: Price must be a non-negative number with sensible upper bound
    checks:
      - { type: notNull, severity: critical }
      - { type: min, value: 0, severity: critical }
      - { type: max, value: 99999.99, severity: warning }
```

### Use in a pipeline

```yaml
# customers.pipeline.yaml
dq:
  rulesFile: ./shared/rules.yaml # tell ConfigLoader where to find composite rules
  rules:
    - field: VAT_NUMBER
      checks:
        - { type: ukVatNumber } # expands to the pattern check above at load time

    - field: COST_PRICE
      checks:
        - { type: positivePrice } # expands to all three checks at load time
```

`ConfigLoader` expands composite-rule references into their underlying built-in checks **before** Zod validation runs, so the DQ engine only ever sees standard check types.

### When to reach for Tier 1

- The same combination of checks repeats across multiple fields or pipelines.
- The combination doesn't need any custom code — built-in checks suffice.
- You want non-developers (data analysts, project managers) to be able to read and edit the rules.

### Constraints

- Composite rule IDs must be valid identifiers (`^[a-zA-Z][a-zA-Z0-9_-]*$`) and must not collide with built-in check type names (`notNull`, `unique`, `pattern`, etc.).
- Composite rules can only contain built-in checks — they cannot reference other composite rules (no nesting).

---

## Tier 2 — File-based plugins

When you need actual logic — a check that calls a custom regex with side conditions, a transform that does business-specific date parsing, a merge strategy that picks the maximum value across sources — write a TypeScript plugin file.

Plugins are auto-discovered from a `plugins/` directory next to your pipeline YAML (or from any directory passed via `--plugins`).

### File naming convention

| Filename suffix                       | Plugin type     | Exported symbol                                   |
| ------------------------------------- | --------------- | ------------------------------------------------- |
| `*.rule.ts` (or `.rule.js`)           | DQ rule         | `export const rule: RulePlugin`                   |
| `*.transform.ts` (or `.transform.js`) | Field transform | `export const transform: TransformPlugin`         |
| `*.merge.ts` (or `.merge.js`)         | Merge strategy  | `export const mergeStrategy: MergeStrategyPlugin` |

### Example — DQ rule plugin

```typescript
// plugins/ifs-customer-no.rule.ts
import type { RulePlugin } from "@caracal-lynx/sluice";

export const rule: RulePlugin = {
  id: "ifsCustomerNo",
  description: "IFS customer number — three uppercase letters followed by 4–7 digits",

  validate(value, config, rowIndex, field) {
    if (typeof value !== "string") return null;
    if (/^[A-Z]{3}[0-9]{4,7}$/.test(value)) return null;
    return {
      field,
      rowIndex,
      value,
      rule: "ifsCustomerNo",
      severity: config.severity,
      message: config.message ?? `${value} is not a valid IFS customer number`,
    };
  },
};
```

Use it in a pipeline:

```yaml
dq:
  rules:
    - field: CUSTOMER_NO
      checks:
        - { type: ifsCustomerNo, severity: critical }
```

### Example — transform plugin

```typescript
// plugins/season-from-date.transform.ts
import type { TransformPlugin } from "@caracal-lynx/sluice";

export const transform: TransformPlugin = {
  id: "seasonFromDate",
  description: "Derives a fashion season code (SS25, AW25 …) from a YYYY-MM-DD launch date",

  apply(value, row, config) {
    if (typeof value !== "string") return null;
    const match = /^(\d{4})-(\d{2})-/.exec(value);
    if (!match) return null;
    const [, year, month] = match;
    const yy = year!.slice(2);
    const mm = parseInt(month!, 10);
    return mm >= 1 && mm <= 6 ? `SS${yy}` : `AW${yy}`;
  },
};
```

Use it in a pipeline:

```yaml
transform:
  fields:
    - { from: LAUNCH_DATE, to: Season, type: custom, customOp: seasonFromDate }
```

### Example — merge strategy plugin

```typescript
// plugins/max-cost.merge.ts
import type { MergeStrategyPlugin } from "@caracal-lynx/sluice";

export const mergeStrategy: MergeStrategyPlugin = {
  id: "max-cost",
  description: "Coalesce by key, picking the highest COST_PRICE across all sources",
  async merge(store, sources, config) {
    // Implementation uses the StagingStore SQL surface — see docs for full example
    // ...
    return { rowsMerged: 0, conflicts: 0, unmatched: 0, tableName: "stg_merged" };
  },
};
```

### Loading & discovery

By default, the runner scans `{cwd}/plugins/` for files matching the suffixes above. You can pass extra directories with `--plugins`:

```bash
sluice run customers.pipeline.yaml --plugins ./shared/plugins --plugins ./team/plugins
```

All discovered plugins are registered before any pipeline phase runs. Duplicate IDs (across files, directories, or with built-ins) raise a `ConfigError` at startup — fail fast.

### Constraints

- **Plugins must be pure.** No I/O, no async, no mutation of the input row, no global state. The DQ and transform engines call them in tight loops — side effects break determinism.
- **Errors must be predictable.** `RulePlugin.validate` returns `null` for "valid"; throw only on unrecoverable bugs. `TransformPlugin.apply` returns the transformed value; throw `TransformError` to fail the row.
- **Plugin IDs are global.** `ifsCustomerNo` lives in the same namespace as the built-in `notNull`, `unique`, etc. Choose distinctive IDs.

---

## Tier 3 — npm package plugins

When you want to **distribute** a plugin — to other projects in your organisation, to a client engagement, or to the public — package it as an npm module and register it via Sluice's package-discovery mechanism.

### Package shape

A plugin package exports a `register()` function that registers any combination of rules, transforms, and merge strategies:

```typescript
// @your-org/sluice-rules-uk/src/index.ts
import type {
  PluginPackage,
  RuleRegistry,
  TransformRegistry,
  MergeStrategyRegistry,
} from "@caracal-lynx/sluice";
import { ukVatNumber } from "./rules/uk-vat-number.js";
import { ukPostcode } from "./rules/uk-postcode-strict.js";
import { sortCodeAccount } from "./rules/sort-code-account.js";

export const plugin: PluginPackage = {
  register(rules: RuleRegistry, transforms: TransformRegistry, options, merges) {
    rules.register(ukVatNumber);
    rules.register(ukPostcode);
    rules.register(sortCodeAccount);
    // transforms.register(...) and merges?.register(...) work the same way
  },
};
```

`package.json`:

```json
{
  "name": "@your-org/sluice-rules-uk",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "@caracal-lynx/sluice": "^0.1.0"
  }
}
```

### Wiring it into a pipeline project

Each Sluice project can declare its npm plugin packages in a top-level `sluice.config.yaml`:

```yaml
# sluice.config.yaml — alongside your pipeline YAMLs
version: "1.0"

plugins:
  - package: "@your-org/sluice-rules-uk"
    options: # passed verbatim to register()
      enableExperimental: false
  - package: "@your-org/sluice-rules-fashion"
```

Then `npm install` the packages and `sluice run` will load them automatically:

```bash
npm install @your-org/sluice-rules-uk @your-org/sluice-rules-fashion
sluice run customers.pipeline.yaml
```

### When to reach for Tier 3

- You want to share a plugin across multiple projects or teams.
- You want to publish a commercial plugin (paid adapter, domain rule pack).
- You want versioning and changelogs separate from your pipeline configs.

### Distribution

Public plugins go on the public npm registry. Private plugins use a private registry (npmjs.com Pro plan, GitHub Packages, Verdaccio, etc.) — Sluice doesn't care which.

If you publish a public plugin, please mention `@caracal-lynx/sluice` as a `peerDependency` rather than a direct dependency, and declare a SemVer range that matches the Sluice public API surface you depend on.

---

## Plugin contracts (the rules)

Regardless of tier, every Sluice plugin must obey these:

1. **Pure.** No filesystem, network, database, or environment access. No timers, no `Math.random()` without a seed, no `Date.now()`. Plugins run inside tight loops — side effects break determinism and reproducibility.
2. **Synchronous.** `RulePlugin.validate`, `TransformPlugin.apply`, and `MergeStrategyPlugin.merge` are called via the engine's synchronous (or `async`-but-deterministic) hot path. (`MergeStrategyPlugin` is `async` because merge strategies query the staging DB; their async-ness is bounded to that.)
3. **Idempotent and stateless.** Calling a plugin twice with the same input must produce the same output. No instance state, no closures over external mutables.
4. **Throw `TransformError` / return `RuleViolation`** — don't throw raw strings, don't return `undefined`. The engine catches at the pipeline boundary.
5. **Don't mutate the row.** Plugins receive the source row by reference for cross-field reads; treat it as read-only.

The one exception to Rule 1 is the **enrich phase** (Phase 4) — `EnrichPlugin` is async and may call external APIs. That's a separate plugin interface (`@caracal-lynx/sluice-enrich`) with its own contract; see the enrich-phase docs for details.

---

## More

- The full schema reference for pipeline YAML, including how built-in checks and transforms work, lives in [CLAUDE.md](CLAUDE.md).
- The runtime types (`RulePlugin`, `TransformPlugin`, `MergeStrategyPlugin`, `PluginPackage`) are exported from the package root: `import type { RulePlugin } from '@caracal-lynx/sluice'`.
- Working examples of all three tiers ship in this repo's `tests/fixtures/plugins/` and `tests/fixtures/shared-rules.yaml`.

Questions, gaps, or contributions to this guide? Open a Discussion or send a PR.

— Caracal Lynx Limited
