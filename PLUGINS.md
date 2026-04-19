# Sluice Plugin Development Guide

Welcome! This guide covers building custom DQ rules, transform operations, and merge strategies for Sluice pipelines.

## Overview

Plugins extend Sluice with custom functionality without modifying the core engine. There are **three plugin types** and **three loading tiers**.

### Plugin types

| Type | Purpose | File pattern | Used in YAML as |
|------|---------|--------------|-----------------|
| **Rule Plugin** | Custom DQ validation | `*.rule.{ts,js}` | `dq.rules[].checks[].type: <rule-id>` |
| **Transform Plugin** | Custom field transformation | `*.transform.{ts,js}` | `transform.fields[].type: custom` + `customOp: <id>` |
| **Merge Strategy Plugin** | Custom multi-source merge strategy | `*.merge.{ts,js}` | `merge.strategy: <strategy-id>` |

### Loading tiers

| Tier | Mechanism | Reuse scope |
|------|-----------|-------------|
| **Tier 1** | Composite rules in a shared YAML file (`dq.rulesFile`) | Per client — DQ rules only, no TypeScript |
| **Tier 2** | Plugin files in a `plugins/` directory alongside the pipeline YAML | Per client |
| **Tier 3** | npm packages declared in `sluice.config.yaml` | Across all clients |

Tier 1 is documented in the main [README](./README.md#tier-1--composite-rules-yaml-). This guide covers Tiers 2 and 3.

### Plugin contract — important

All plugins must be **pure and synchronous**:

- `validate()` and `apply()` and `merge()` must not perform I/O (no file reads, no HTTP, no DB queries outside the `StagingStore` provided to `merge()`).
- `validate()` and `apply()` must be synchronous — no `async`, no returned Promises. The engines call them without `await`. *(Merge strategies are async — they receive the `StagingStore` and issue queries against it.)*
- Plugins must not mutate the `row` object passed to `apply()` — treat it as read-only.
- Plugin `id` must be unique across all loaded plugins; duplicates throw `ConfigError` at registration time. This includes built-in check types and built-in merge strategies — plugins cannot shadow them.
- Data a plugin needs (e.g. a list of valid codes) should come through the pipeline config via `options`, loaded once by the runner rather than by the plugin on every call.

---

## Plugin Loading

### Tier 2: file-based plugins

Drop plugin files into your project's `plugins/` directory next to the pipeline YAML:

```
your-project/
├── pipeline.yaml
├── .env
└── plugins/
    ├── my-validator.rule.ts          # DQ rule
    ├── my-transformer.transform.ts   # transform
    └── my-strategy.merge.ts          # merge strategy
```

At the start of each pipeline run, Sluice recursively scans this directory and registers every `*.rule.{ts,js}`, `*.transform.{ts,js}`, and `*.merge.{ts,js}` file it finds.

### Tier 3: npm package plugins

Declare npm packages in `sluice.config.yaml` at the project root:

```yaml
version: "1.0"
plugins:
  - package: "@my-org/sluice-email-validators"
    options:
      apiKey: ${VALIDATOR_API_KEY}
  - package: "sluice-geocoding-transforms"
    options:
      provider: "mapbox"
```

Each package must export a `plugin` (or `default`) object with a `register()` function — see [Packaging npm plugins](#packaging-npm-plugins) below.

### Extra plugin directories

The `--plugins` CLI flag adds more directories (on top of the pipeline's own `plugins/`):

```bash
sluice run pipeline.yaml --plugins ./shared/plugins ./team/plugins
```

Directories that resolve to the same absolute path are de-duplicated before loading.

### Viewing loaded plugins

```bash
sluice plugins
# or with extra plugin directories:
sluice plugins --plugins ./shared/plugins
```

Output (pino JSON; pipe through `pino-pretty` in dev):

```json
{
  "level": 30,
  "msg": "sluice plugins: loaded",
  "rules": ["strict-email", "iso-8601-date", "bc-account-code"],
  "transforms": ["slug-generator", "normalize-company-name", "fixed-decimal"],
  "mergeStrategies": ["coalesce", "priority-override", "union", "intersect"]
}
```

The four merge strategies in the output are built-ins — pre-registered at startup in `src/merge/index.ts`. Plugin-registered strategies appear alongside them.

---

## Creating a Rule Plugin

### Basic structure

```typescript
// my-rule.rule.ts
import type { RulePlugin, RuleViolation } from '@caracal-lynx/sluice';
import type { CheckConfig } from '@caracal-lynx/sluice';

export const rule: RulePlugin = {
  id: 'my-rule',                              // must be unique across all rule plugins
                                              // and must not collide with a built-in:
                                              // notNull, unique, pattern, email, ukPostcode,
                                              // maxLength, min, max, allowedValues

  description: 'Optional one-line description',  // optional; used in logs

  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    // Return null if valid, or a RuleViolation if not.
    // Must be pure and synchronous.
    if (isValid(value)) return null;

    return {
      field,
      rowIndex,
      value,
      rule: 'my-rule',
      severity: config.severity,              // 'critical' | 'warning' | 'info'
      message: config.message ?? 'Custom validation failed',
    };
  },
};
```

### Example: UK phone number validator

```typescript
// uk-phone.rule.ts
import type { RulePlugin, RuleViolation } from '@caracal-lynx/sluice';
import type { CheckConfig } from '@caracal-lynx/sluice';

const UK_PHONE = /^(?:\+44\s?7\d{3}|01\d{3,4})[\s-]?\d{3,4}[\s-]?\d{3,4}$/;

export const rule: RulePlugin = {
  id: 'uk-phone',
  description: 'UK mobile or landline number (E.164 or national format)',

  validate(value, config, rowIndex, field): RuleViolation | null {
    // Skip null/empty — let the built-in `notNull` rule handle required-ness.
    if (value === null || value === undefined || String(value).trim() === '') return null;

    const phone = String(value).trim();
    if (UK_PHONE.test(phone)) return null;

    return {
      field,
      rowIndex,
      value,
      rule: 'uk-phone',
      severity: config.severity,
      message: config.message ?? `"${phone}" is not a valid UK phone number`,
    };
  },
};
```

### Using it in a pipeline

```yaml
dq:
  stopOnCritical: false
  rules:
    - field: PhoneNumber
      checks:
        - { type: uk-phone, severity: warning }
        - { type: notNull,  severity: critical }   # built-in still works
```

### Working examples in the repo

- [tests/fixtures/plugins/strict-email.rule.ts](tests/fixtures/plugins/strict-email.rule.ts)
- [tests/fixtures/plugins/iso-8601-date.rule.ts](tests/fixtures/plugins/iso-8601-date.rule.ts)
- [tests/fixtures/plugins/bc-account-code.rule.ts](tests/fixtures/plugins/bc-account-code.rule.ts)

---

## Creating a Transform Plugin

### Basic structure

```typescript
// my-transform.transform.ts
import type { TransformPlugin, CustomFieldMapping } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'my-transform',                       // must be unique across all transform plugins

  description: 'Optional one-line description',

  apply(
    value: unknown,                         // the value at `field.from` (may be null/undefined)
    row: Record<string, unknown>,           // the full source row — READ-ONLY
    config: CustomFieldMapping,             // the field mapping; user options live in config.options
  ): unknown {
    // Return the transformed value. Return null to emit a null in the output.
    // Throw TransformError (or any Error) for unrecoverable failures.
    // Must be pure and synchronous.

    if (value === null || value === undefined) return null;
    const setting = config.options?.['someSetting'];
    return /* transformed value */;
  },
};
```

### Example: title-case transformer

```typescript
// title-case.transform.ts
import type { TransformPlugin, CustomFieldMapping } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'title-case',
  description: 'Title-case a string, optionally preserving all-caps acronyms',

  apply(value, _row, config: CustomFieldMapping): unknown {
    if (value === null || value === undefined) return null;

    const str = String(value).trim();
    if (str === '') return null;

    const preserveAcronyms = (config.options?.['preserveAcronyms'] as boolean) ?? false;

    return str
      .split(/\s+/)
      .map((word) => {
        if (preserveAcronyms && word.length > 1 && word === word.toUpperCase()) {
          return word; // keep "USA", "IBM", etc. as-is
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  },
};
```

### Using it in a pipeline

```yaml
transform:
  fields:
    - from: company_name
      to: CompanyName
      type: custom
      customOp: title-case
      options:
        preserveAcronyms: true
```

### Example: cross-field access via `row`

```typescript
// full-name.transform.ts
import type { TransformPlugin, CustomFieldMapping } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'full-name',
  description: 'Concatenate two source fields into a single name string',

  apply(_value, row, config: CustomFieldMapping): unknown {
    const firstKey = (config.options?.['firstField'] as string) ?? 'FIRST_NAME';
    const lastKey  = (config.options?.['lastField']  as string) ?? 'LAST_NAME';
    const first    = String(row[firstKey] ?? '').trim();
    const last     = String(row[lastKey]  ?? '').trim();
    const full     = [first, last].filter(Boolean).join(' ');
    return full === '' ? null : full;
  },
};
```

### Working examples in the repo

- [tests/fixtures/plugins/slug-generator.transform.ts](tests/fixtures/plugins/slug-generator.transform.ts)
- [tests/fixtures/plugins/normalize-company-name.transform.ts](tests/fixtures/plugins/normalize-company-name.transform.ts)
- [tests/fixtures/plugins/fixed-decimal.transform.ts](tests/fixtures/plugins/fixed-decimal.transform.ts)
- [tests/fixtures/plugins/margin.transform.ts](tests/fixtures/plugins/margin.transform.ts)
- [tests/fixtures/plugins/concat.transform.ts](tests/fixtures/plugins/concat.transform.ts)

---

## Creating a Merge Strategy Plugin

Merge strategy plugins let you implement custom multi-source merge logic for pipelines that declare `sources:` + `merge:` (see the [multi-source merge section](./README.md#-multi-source-merge) in the README).

Unlike rule and transform plugins, merge strategies **are async**, receive a live `StagingStore`, and are responsible for producing the `stg_merged` table.

### Interface

```typescript
interface MergeStrategyPlugin {
  readonly id: string;              // must match merge.strategy in YAML
  readonly description?: string;    // optional; shown by `sluice merge list-strategies`

  merge(
    store:   StagingStore,
    sources: MergeSourceMeta[],     // priority-ordered (priority 1 first)
    config:  MergeConfig,
  ): Promise<MergeResult>;
}

interface MergeSourceMeta {
  id:        string;
  priority:  number;
  tableName: string;                // e.g. 'stg_raw_sql-server'
}

interface MergeResult {
  rowsMerged: number;
  conflicts:  number;
  unmatched:  number;
  tableName:  'stg_merged';
}
```

### Built-in strategies as reference

Before writing a new strategy, read the built-ins — they cover the common shape (validate keys, `FULL OUTER JOIN` all sources, pick values, produce `stg_merged`):

- [src/merge/strategies/coalesce.ts](src/merge/strategies/coalesce.ts) — first non-null wins
- [src/merge/strategies/priority-override.ts](src/merge/strategies/priority-override.ts) — highest priority wins even if null
- [src/merge/strategies/union.ts](src/merge/strategies/union.ts) — all rows, deduped by key
- [src/merge/strategies/intersect.ts](src/merge/strategies/intersect.ts) — only rows in every source

The SQL builder helpers in [src/merge/sql-builder.ts](src/merge/sql-builder.ts) (`buildJoinedTableSql`, `buildMergedTableSql`, `normalizeKeyColumns`, etc.) and the conflict logger in [src/merge/conflict-log.ts](src/merge/conflict-log.ts) are re-usable from a custom strategy.

### Skeleton

```typescript
// weighted-merge.merge.ts
import type {
  MergeStrategyPlugin,
  MergeSourceMeta,
  MergeResult,
} from '@caracal-lynx/sluice';
import type { MergeConfig } from '@caracal-lynx/sluice';
import type { StagingStore } from '@caracal-lynx/sluice';

export const mergeStrategy: MergeStrategyPlugin = {
  id: 'weighted-merge',
  description: 'Merge by weighted average of numeric fields',

  async merge(
    store: StagingStore,
    rawSources: MergeSourceMeta[],
    config: MergeConfig,
  ): Promise<MergeResult> {
    // 1. Sort sources by priority (priority 1 first).
    const sources = [...rawSources].sort((a, b) => a.priority - b.priority);

    // 2. Validate: every source table must contain every key column.
    //    (Throw ConfigError — see src/utils/errors.ts.)

    // 3. Build the joined table (full outer join on keys).
    //    You can re-use buildJoinedTableSql() from the SQL builder module.

    // 4. Create stg_merged with your custom column-selection logic.

    // 5. Optionally populate stg_merge_conflicts and export to config.conflictLog.

    return {
      rowsMerged: await store.rowCount('stg_merged'),
      conflicts:  0,
      unmatched:  0,
      tableName:  'stg_merged',
    };
  },
};
```

### Using it in a pipeline

```yaml
merge:
  key: STYLE_NO
  strategy: weighted-merge
  onUnmatched: include
```

### Inspecting registered strategies

```bash
sluice merge list-strategies          # id + description for every registered strategy
sluice merge info weighted-merge      # details for one strategy
```

### Reference fixture

- [tests/fixtures/plugins/test.merge.ts](tests/fixtures/plugins/test.merge.ts) — minimal stub used by the plugin loader tests

---

## Options & Configuration

Transform and merge plugins receive user-supplied options through the pipeline config. Always provide sensible defaults and cast explicitly:

```typescript
export const transform: TransformPlugin = {
  id: 'slugify',
  apply(value, _row, config): unknown {
    const maxLength = (config.options?.['maxLength'] as number) ?? 100;
    const separator = (config.options?.['separator'] as string) ?? '-';
    const lowercase = (config.options?.['lowercase'] as boolean) ?? true;

    let result = String(value ?? '').trim();
    if (lowercase) result = result.toLowerCase();
    result = result.replace(/\s+/g, separator).slice(0, maxLength);

    return result || null;
  },
};
```

Usage:

```yaml
transform:
  fields:
    - from: description
      to: slug
      type: custom
      customOp: slugify
      options:
        maxLength: 50
        separator: "_"
        lowercase: false
```

---

## Error Handling

### Rule plugins

Return a `RuleViolation` if validation fails; return `null` if valid. Throwing from inside `validate()` bubbles up as a `PipelineError` and halts the run — don't use throw for soft failures. Use severity (`critical`/`warning`/`info`) to control per-row behaviour.

### Transform plugins

Throw `TransformError` (or any `Error`) for unrecoverable failures. The engine catches per-row errors and either skips the row (`run.onError: continue`, the default) or aborts (`run.onError: stop`):

```typescript
import type { TransformPlugin } from '@caracal-lynx/sluice';
import { TransformError } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'json-extract',
  apply(value, _row, config): unknown {
    if (value === null || value === undefined) return null;

    try {
      const obj = JSON.parse(String(value));
      const key = config.options?.['key'] as string;
      if (!key) throw new TransformError('json-extract: missing required option `key`');
      return obj[key] ?? null;
    } catch (err) {
      throw new TransformError(`json-extract: ${String(err)}`, err);
    }
  },
};
```

### Merge strategy plugins

Throw `ConfigError` for validation problems (missing key column on a source, bad config) and `PipelineError` for runtime failures. Use `MergeResult.unmatched` / `.conflicts` to report soft signals rather than throwing.

---

## Testing Plugins

### Rule plugins

`validate()` is pure and synchronous — call it directly:

```typescript
import { describe, it, expect } from 'vitest';
import type { CheckConfig } from '@caracal-lynx/sluice';
import { rule as ukPhone } from './uk-phone.rule.js';

const cfg: CheckConfig = { type: 'pattern', severity: 'warning' };

describe('uk-phone', () => {
  it('accepts valid UK numbers', () => {
    expect(ukPhone.validate('+447700900000', cfg, 0, 'phone')).toBeNull();
  });

  it('rejects invalid numbers', () => {
    const result = ukPhone.validate('12345', cfg, 0, 'phone');
    expect(result).not.toBeNull();
    expect(result?.severity).toBe('warning');
  });

  it('skips null values', () => {
    expect(ukPhone.validate(null, cfg, 0, 'phone')).toBeNull();
  });
});
```

### Transform plugins

`apply()` is synchronous and takes three arguments — `(value, row, config)`:

```typescript
import { describe, it, expect } from 'vitest';
import type { CustomFieldMapping } from '@caracal-lynx/sluice';
import { transform as titleCase } from './title-case.transform.js';

function cfg(options: Record<string, unknown> = {}): CustomFieldMapping {
  return { to: 'X', type: 'custom', customOp: 'title-case', options };
}

describe('title-case', () => {
  it('title-cases words', () => {
    expect(titleCase.apply('hello world', {}, cfg())).toBe('Hello World');
  });

  it('preserves acronyms when requested', () => {
    expect(titleCase.apply('USA today', {}, cfg({ preserveAcronyms: true })))
      .toBe('USA Today');
  });

  it('returns null for empty strings', () => {
    expect(titleCase.apply('', {}, cfg())).toBeNull();
  });
});
```

### Merge strategy plugins

`merge()` is async and needs a `StagingStore`. Use an in-memory DuckDB store with seeded source tables — see the integration tests in [tests/integration/merge-strategies.test.ts](tests/integration/merge-strategies.test.ts) for a full pattern.

---

## Packaging npm Plugins

Promote reusable plugins to a scoped npm package once they're useful across clients.

### Package structure

```
sluice-my-rules/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # exports register()
│   ├── rules/
│   │   ├── my-rule.ts
│   │   └── another-rule.ts
│   ├── transforms/
│   │   ├── my-transform.ts
│   │   └── another-transform.ts
│   └── strategies/
│       └── my-merge.ts
└── dist/                        # compiled output (tsc)
```

### package.json

```json
{
  "name": "@my-org/sluice-my-rules",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "peerDependencies": {
    "@caracal-lynx/sluice": "^0.1.0"
  }
}
```

### src/index.ts — the `register()` contract

The plugin loader calls `register(rules, transforms, options?, mergeStrategies?)`. Your package must export either a named `plugin` object or a `default` with a `register()` function matching this signature:

```typescript
import type {
  RuleRegistry,
  TransformRegistry,
  MergeStrategyRegistry,
  PluginPackage,
} from '@caracal-lynx/sluice';

import { rule as emailRule }     from './rules/email.js';
import { rule as phoneRule }     from './rules/phone.js';
import { transform as slug }     from './transforms/slug.js';
import { mergeStrategy as avg }  from './strategies/avg.js';

export const plugin: PluginPackage = {
  register(
    rules:            RuleRegistry,
    transforms:       TransformRegistry,
    options?:         Record<string, unknown>,   // from sluice.config.yaml
    mergeStrategies?: typeof MergeStrategyRegistry,
  ): void {
    rules.register(emailRule);
    rules.register(phoneRule);
    transforms.register(slug);
    if (mergeStrategies) mergeStrategies.register(avg);
  },
};

// `default` export also works — the loader tries `plugin` first, then `default`.
export default plugin;
```

### Using the package in a client project

`sluice.config.yaml` (at the project root):

```yaml
version: "1.0"
plugins:
  - package: "@my-org/sluice-my-rules"
    options:
      strictMode: true           # passed to register() as the `options` arg
```

Then:

```bash
npm install @my-org/sluice-my-rules
sluice plugins                   # confirm they registered
```

---

## Best Practices

### 1. Handle null/undefined consistently

```typescript
// ✅ Good — explicit about what counts as absent
if (value === null || value === undefined) return null;

// ❌ Avoid — breaks for 0, false, empty string
if (!value) return null;
```

### 2. Let `notNull` handle required-ness

A rule that skips null but otherwise validates lets pipeline authors compose with the built-in `notNull` check:

```yaml
checks:
  - { type: notNull, severity: critical }
  - { type: uk-phone, severity: warning }
```

### 3. Provide clear error messages

```typescript
// ✅ Good
message: `"${value}" does not match expected format: ${pattern}`

// ❌ Avoid
message: 'Invalid'
```

### 4. Use TypeScript strict mode

```json
// tsconfig.json
{ "compilerOptions": { "strict": true, "exactOptionalPropertyTypes": true } }
```

### 5. Document options with examples in the plugin file

```typescript
export const transform: TransformPlugin = {
  id: 'slugify',
  description: 'URL-safe slug generator',
  /**
   * Options:
   *   - maxLength (number, default 100): truncate after N chars
   *   - separator (string, default '-'): word separator
   *   - lowercase (boolean, default true): convert to lowercase
   *
   * YAML usage:
   *   type: custom
   *   customOp: slugify
   *   options: { maxLength: 50, separator: '_' }
   */
  apply(value, _row, config): unknown { /* ... */ },
};
```

### 6. Test edge cases

```typescript
it('handles unicode characters', () => {
  expect(transform.apply('Café', {}, cfg())).toBe('cafe');
});

it('handles very long strings', () => {
  const long = 'a'.repeat(10000);
  expect(transform.apply(long, {}, cfg({ maxLength: 100 }))).toHaveLength(100);
});
```

---

## Anti-patterns

Things the plugin contract explicitly disallows:

- ❌ **I/O in `validate()` or `apply()`** — no file reads, HTTP calls, database queries. Data a plugin needs must arrive through `config.options`, loaded once by the runner.
- ❌ **`async validate()` or `async apply()`** — the engines call these without `await`. A returned Promise would be stored verbatim in the staging table and corrupt downstream stages.
- ❌ **Mutating `row`** inside `apply()` — the same row object may be passed to other field mappings; mutation bleeds between fields.
- ❌ **Shadowing a built-in id** — a plugin with `id: 'notNull'` or `id: 'coalesce'` will collide with a built-in and throw `ConfigError`.
- ❌ **Multiple plugins per file** — the loader only reads the named `rule` / `transform` / `mergeStrategy` export. One file per plugin.

---

## Troubleshooting

### Plugin not loading?

1. Check the filename suffix: `.rule.{ts,js}`, `.transform.{ts,js}`, or `.merge.{ts,js}`.
2. Verify the `plugins/` directory is in the same folder as the pipeline YAML, or pass `--plugins <dir>` on the command line.
3. Run `sluice plugins` to see exactly what loaded.
4. Re-run with `--log-level debug` — each file that's loaded logs a `Registered ... plugin` message.

### "Unknown rule type" / "Unknown customOp" / "No merge strategy registered for id"?

1. Check the plugin's `id` matches the YAML reference exactly (it's case-sensitive).
2. Run `sluice plugins` — if your plugin isn't in the list, it didn't register; see above.
3. Check for duplicate ids across multiple plugins or packages (duplicate registration throws `ConfigError`).

### Plugin crashes during execution?

1. Wrap inner logic in try/catch and throw `TransformError` / `ConfigError` with a clear message.
2. For transforms, set `run.onError: stop` temporarily to get the full stack trace.
3. Unit-test the plugin directly — call `validate()` or `apply()` with realistic inputs.

---

## Examples in this repo

Real plugin files used by the test suite — copy these as starting points:

- `tests/fixtures/plugins/*.rule.ts` — rule plugins (email, date, account code, etc.)
- `tests/fixtures/plugins/*.transform.ts` — transform plugins (slugify, normalise company name, margin, etc.)
- `tests/fixtures/plugins/test.merge.ts` — minimal merge strategy stub
- `tests/fixtures/plugins/TEMPLATE-rule.rule.ts` — rule starter template
- `tests/fixtures/plugins/TEMPLATE-transform.transform.ts` — transform starter template

---

## Questions?

File an issue on the Sluice repo. Happy extending! 🚀
