# Sluice — Phase 3 Extensions
# Custom validation and transformation rules
# npm package: @caracal-lynx/sluice
# Owner: Michael Scott, Caracal Lynx Ltd. (SC826823)
# Depends on: CLAUDE.md (Phase 1 complete)
# Last updated: 2026-04-15

---

> ✅ **STATUS: COMPLETE** — The three-tier plugin/extension system described in this document has been fully implemented. This document is now a specification reference for the completed Phase 3 plugin system.

---

## Overview

Phase 3 adds a three-tier extension system that allows custom DQ rules and
transformation operations to be introduced without modifying the core engine.

| Tier | Mechanism | Skill level | Reuse scope |
|---|---|---|---|
| 1 | Composite rules in YAML | Config author | Per client |
| 2 | Plugin files (TypeScript) | Developer | Per client |
| 3 | npm packages | Developer | Across all clients |

All three tiers share the same registry interfaces and are invoked identically
by the DQ and transform engines. The engine does not know or care which tier
a rule came from.

---

## New files and changes to existing files

### New files

```
src/
├── plugins/
│   ├── loader.ts              ← discovers and loads plugin files at startup
│   ├── registry.ts            ← RuleRegistry and TransformRegistry classes
│   └── types.ts               ← TransformPlugin, CompositeRule, PluginPackage

shared/                        ← gitignored per-client; lives in client repos
└── rules.yaml                 ← composite rule library (Tier 1)

sluice.config.yaml        ← project-level config: npm plugin packages (Tier 3)
```

### Modified files

```
src/config/
├── schema.ts                  ← add rulesFile, plugins, customOp fields
└── loader.ts                  ← resolve rulesFile; expand composite rules

src/runner.ts                  ← call PluginLoader before phase 1; pass registries
src/dq/engine.ts               ← accept RuleRegistry; look up custom rules
src/transform/engine.ts        ← accept TransformRegistry; handle type: custom
src/cli.ts                     ← add --plugins flag
```

---

## ═══════════════════════════════════════════════════════════
## TIER 1 — COMPOSITE RULES IN YAML
## ═══════════════════════════════════════════════════════════

### Concept

Named rules assembled from existing built-in checks, defined in a shared YAML
library and referenced in pipeline configs by id. No TypeScript required.
Composite rules are expanded by the config loader before the DQ engine runs.

### Shared rule library format  (shared/rules.yaml)

```yaml
# shared/rules.yaml
# Shared DQ rule library for Eribé Knitwear.
# Reference in pipeline YAML: dq.rulesFile: ../../shared/rules.yaml

version: "1.0"

rules:

  # ── String format rules ──────────────────────────────────

  - id: eribeStyleNo
    description: Eribé internal style number — two uppercase letters + four digits
    checks:
      - { type: notNull,    severity: critical }
      - { type: pattern,    value: "^[A-Z]{2}[0-9]{4}$", severity: critical }
      - { type: maxLength,  value: 6,  severity: critical }

  - id: eribeColourCode
    description: Three-digit numeric colour code
    checks:
      - { type: notNull,    severity: critical }
      - { type: pattern,    value: "^[0-9]{3}$", severity: critical }

  - id: eribeSeasonCode
    description: Season code — SS or AW followed by two-digit year
    checks:
      - { type: notNull,    severity: warning }
      - { type: pattern,    value: "^(SS|AW)[0-9]{2}$", severity: warning,
          message: "Expected format: SS25 or AW26" }

  - id: ifsAccountCode
    description: IFS general ledger account — six digits
    checks:
      - { type: notNull,    severity: critical }
      - { type: pattern,    value: "^[0-9]{6}$", severity: critical }

  - id: ifsCustomerNo
    description: IFS customer number — 3-10 uppercase alphanumeric
    checks:
      - { type: notNull,    severity: critical }
      - { type: unique,     severity: critical }
      - { type: pattern,    value: "^[A-Z0-9]{3,10}$", severity: warning }

  # ── Numeric rules ─────────────────────────────────────────

  - id: positivePrice
    description: Price must be a non-negative number
    checks:
      - { type: notNull,    severity: critical }
      - { type: min,        value: 0,       severity: critical }
      - { type: max,        value: 99999.99, severity: warning }

  - id: positiveQuantity
    checks:
      - { type: notNull,    severity: critical }
      - { type: min,        value: 0,       severity: critical }
      - { type: max,        value: 999999,  severity: warning }

  # ── Contact / identity rules ──────────────────────────────

  - id: ukVatNumber
    description: UK VAT number — GB prefix + 9, 12, or GD/HA + 3 digits
    checks:
      - { type: notNull,    severity: warning }
      - { type: pattern,
          value: "^GB([0-9]{9}|[0-9]{12}|(GD|HA)[0-9]{3})$",
          severity: warning,
          message: "Expected: GB123456789 or GB123456789012 or GBGD123" }

  - id: ukSortCode
    description: UK bank sort code — six digits, optionally hyphen-separated
    checks:
      - { type: pattern,    value: "^[0-9]{2}-?[0-9]{2}-?[0-9]{2}$",
          severity: warning }

  - id: ibanNumber
    description: Basic IBAN format check (length and alphanumeric)
    checks:
      - { type: pattern,    value: "^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$",
          severity: warning }
```

### Using composite rules in a pipeline

```yaml
dq:
  rulesFile: ../../shared/rules.yaml   # Path relative to the pipeline YAML file.
                                       # Resolved at load time; composite rule ids
                                       # become available as if built-in.
  stopOnCritical: true
  rules:
    - field: STYLE_NO
      checks:
        - { type: eribeStyleNo }       # Expands to three checks at load time.

    - field: COST_PRICE
      checks:
        - { type: positivePrice }      # Expands to three checks.
        - { type: max, value: 500.00, severity: warning }
                                       # Composite + built-in checks can be mixed.

    - field: COLOUR_CODE
      checks:
        - { type: eribeColourCode }
```

### Loader expansion logic  (src/config/loader.ts)

When `dq.rulesFile` is present:

1. Load and parse the rules YAML file.
2. Validate it against `CompositeRuleLibrarySchema` (Zod).
3. Build a `Map<string, CheckConfig[]>` of id → checks.
4. Walk `dq.rules[].checks[]`. For any check whose `type` matches a composite
   rule id, replace that single check entry with the expanded checks array,
   inheriting the composite rule's severity values unless the pipeline YAML
   overrides them with a `severity` key on the composite check entry.
5. The expanded config is then passed to `PipelineSchema.parse()` as normal —
   by the time Zod sees it, all types are built-in check types.

**Severity override on composite rule usage:**

```yaml
- field: VENDOR_CODE
  checks:
    # Downgrade a composite rule's critical checks to warnings for this field:
    - { type: ifsCustomerNo, severity: warning }
    # When severity is present on the composite check entry, it overrides
    # ALL severity values within the expanded checks.
```

### Zod schema additions for Tier 1

```typescript
// src/config/schema.ts — additions

export const CompositeRuleSchema = z.object({
  id:          z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  description: z.string().optional(),
  checks:      z.array(CheckSchema).min(1),
});

export const CompositeRuleLibrarySchema = z.object({
  version: z.string(),
  rules:   z.array(CompositeRuleSchema).min(1),
});

// Add to DqSchema:
export const DqSchema = z.object({
  rulesFile:      z.string().optional(),   // ← NEW
  stopOnCritical: z.boolean().default(true),
  rejectionFile:  z.string().optional(),
  rules:          z.array(DqRuleSchema).default([]),
});

export type CompositeRule        = z.infer<typeof CompositeRuleSchema>;
export type CompositeRuleLibrary = z.infer<typeof CompositeRuleLibrarySchema>;
```

---

## ═══════════════════════════════════════════════════════════
## TIER 2 — PLUGIN FILES (TYPESCRIPT)
## ═══════════════════════════════════════════════════════════

### Concept

TypeScript files dropped into a `plugins/` folder alongside the client's pipeline
YAML files. Auto-discovered by the plugin loader at startup. Two file conventions:

| Filename pattern | Type | Registered in |
|---|---|---|
| `*.rule.ts` | Custom DQ rule | RuleRegistry |
| `*.transform.ts` | Custom transform operation | TransformRegistry |

### Plugin interfaces  (src/plugins/types.ts)

```typescript
import type { CheckConfig } from '@/config/types';

// ── DQ Rule plugin ────────────────────────────────────────────

export interface RulePlugin {
  /** Must match the 'type' key used in pipeline YAML checks. */
  readonly id: string;

  /** Optional human-readable description for error messages and profiling. */
  readonly description?: string;

  /**
   * Validate a single cell value.
   * Return null if valid; RuleViolation if not.
   * Must be pure — no side effects, no I/O.
   */
  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string
  ): RuleViolation | null;
}

export interface RuleViolation {
  field:     string;
  rowIndex:  number;
  value:     unknown;
  rule:      string;
  severity:  'critical' | 'warning' | 'info';
  message:   string;
}

// ── Transform plugin ──────────────────────────────────────────

export interface TransformPlugin {
  /**
   * Must match the 'customOp' key used in pipeline YAML field mappings.
   * Used with: type: custom, customOp: <id>
   */
  readonly id: string;
  readonly description?: string;

  /**
   * Transform a single source value.
   * Receives the raw value and the full source row for cross-field operations.
   * Return the transformed value. Return null to emit a null in the output.
   * Throw TransformError for unrecoverable errors.
   * Must be pure — no side effects, no I/O.
   */
  apply(
    value: unknown,
    row: Record<string, unknown>,
    config: CustomFieldMapping
  ): unknown;
}

export interface CustomFieldMapping {
  from?:     string | string[];
  to:        string;
  type:      'custom';
  customOp:  string;
  options?:  Record<string, unknown>;  // arbitrary per-plugin config from YAML
  default?:  unknown;
  optional?: boolean;
}

// ── Registration function (Tier 3 npm packages) ───────────────

export interface PluginPackage {
  register(
    rules:      RuleRegistry,
    transforms: TransformRegistry
  ): void;
}
```

### RuleRegistry and TransformRegistry  (src/plugins/registry.ts)

```typescript
import type { RulePlugin, TransformPlugin } from './types';
import { ConfigError } from '@/utils/errors';

export class RuleRegistry {
  private readonly plugins = new Map<string, RulePlugin>();

  register(plugin: RulePlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new ConfigError(
        `Duplicate rule plugin id "${plugin.id}". ` +
        `Check plugins/ folder and npm plugin packages for conflicts.`
      );
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): RulePlugin | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  list(): string[] {
    return [...this.plugins.keys()];
  }
}

export class TransformRegistry {
  private readonly plugins = new Map<string, TransformPlugin>();

  register(plugin: TransformPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new ConfigError(`Duplicate transform plugin id "${plugin.id}".`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): TransformPlugin | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  list(): string[] {
    return [...this.plugins.keys()];
  }
}
```

### Plugin loader  (src/plugins/loader.ts)

```typescript
import path   from 'path';
import { glob } from 'glob';
import { logger } from '@/utils/logger';
import { ConfigError } from '@/utils/errors';
import type { RuleRegistry, TransformRegistry } from './registry';

export async function loadPlugins(
  pluginDir: string,
  rules:      RuleRegistry,
  transforms: TransformRegistry
): Promise<void> {
  if (!fs.existsSync(pluginDir)) return;  // no plugins dir is fine

  // Discover rule plugins
  const ruleFiles = await glob('**/*.rule.ts', { cwd: pluginDir, absolute: true });
  for (const file of ruleFiles) {
    try {
      const mod = await import(file);
      if (!mod.rule?.id) throw new Error('Missing export: const rule: RulePlugin');
      rules.register(mod.rule);
      logger.debug({ plugin: mod.rule.id, file }, 'Registered rule plugin');
    } catch (err) {
      throw new ConfigError(`Failed to load rule plugin ${file}: ${err}`);
    }
  }

  // Discover transform plugins
  const transformFiles = await glob('**/*.transform.ts', { cwd: pluginDir, absolute: true });
  for (const file of transformFiles) {
    try {
      const mod = await import(file);
      if (!mod.transform?.id) throw new Error('Missing export: const transform: TransformPlugin');
      transforms.register(mod.transform);
      logger.debug({ plugin: mod.transform.id, file }, 'Registered transform plugin');
    } catch (err) {
      throw new ConfigError(`Failed to load transform plugin ${file}: ${err}`);
    }
  }

  logger.info({
    rulePlugins:      rules.list().length,
    transformPlugins: transforms.list().length,
  }, 'Plugins loaded');
}
```

### Example rule plugin files

```typescript
// clients/eribe/plugins/ukVatNumber.rule.ts
import type { RulePlugin, RuleViolation } from '@caracal-lynx/sluice';

export const rule: RulePlugin = {
  id: 'ukVatNumber',
  description: 'UK VAT registration number (GB prefix)',

  validate(value, config, rowIndex, field): RuleViolation | null {
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;  // notNull rule handles this separately
    }
    const v = String(value).replace(/[\s-]/g, '').toUpperCase();
    const valid = /^GB([0-9]{9}|[0-9]{12}|(GD|HA)[0-9]{3})$/.test(v);
    if (valid) return null;
    return {
      field, rowIndex, value, rule: 'ukVatNumber',
      severity: config.severity,
      message:  config.message ?? `Invalid UK VAT number. Expected GB followed by 9 or 12 digits.`,
    };
  },
};
```

```typescript
// clients/cochran/plugins/ifsGlAccount.rule.ts
import type { RulePlugin, RuleViolation } from '@caracal-lynx/sluice';

const VALID_COST_CENTRES = new Set(['CC001', 'CC002', 'CC010', 'CC020', 'CC030']);

export const rule: RulePlugin = {
  id: 'ifsCostCentre',
  description: 'Must be a valid Cochran IFS cost centre code',

  validate(value, config, rowIndex, field): RuleViolation | null {
    if (!VALID_COST_CENTRES.has(String(value ?? '').toUpperCase())) {
      return {
        field, rowIndex, value, rule: 'ifsCostCentre',
        severity: config.severity,
        message:  `Unknown cost centre. Valid codes: ${[...VALID_COST_CENTRES].join(', ')}`,
      };
    }
    return null;
  },
};
```

```typescript
// clients/eribe/plugins/ukNiNumber.rule.ts
import type { RulePlugin, RuleViolation } from '@caracal-lynx/sluice';

export const rule: RulePlugin = {
  id: 'ukNiNumber',
  description: 'UK National Insurance number format',

  validate(value, config, rowIndex, field): RuleViolation | null {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const v = String(value).replace(/\s/g, '').toUpperCase();
    // NI format: two letters, six digits, one letter (A-D)
    const valid = /^(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z]{2}[0-9]{6}[ABCD]$/.test(v);
    if (valid) return null;
    return {
      field, rowIndex, value, rule: 'ukNiNumber',
      severity: config.severity,
      message:  config.message ?? 'Invalid UK National Insurance number format',
    };
  },
};
```

### Example transform plugin files

```typescript
// clients/cochran/plugins/erpAccountFormat.transform.ts
import type { TransformPlugin } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'erpAccountFormat',
  description: 'Format legacy account code to IFS ACC-XXXXXX format',

  apply(value): unknown {
    const code = String(value ?? '').replace(/\D/g, '').padStart(6, '0');
    return `ACC-${code}`;
  },
};
```

```typescript
// clients/eribe/plugins/seasonFromDate.transform.ts
import type { TransformPlugin } from '@caracal-lynx/sluice';
import dayjs from 'dayjs';

export const transform: TransformPlugin = {
  id: 'seasonFromDate',
  description: 'Derive SS/AW season code from a date field',

  apply(value): unknown {
    const d = dayjs(String(value ?? ''));
    if (!d.isValid()) return null;
    const year  = String(d.year()).slice(-2);
    const month = d.month() + 1;         // dayjs months are 0-indexed
    return month >= 2 && month <= 7 ? `SS${year}` : `AW${year}`;
  },
};
```

```typescript
// clients/eribe/plugins/styleDescClean.transform.ts
import type { TransformPlugin, CustomFieldMapping } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'styleDescClean',
  description: 'Clean style description — normalise Unicode, remove trademark symbols',

  apply(value, _row, config: CustomFieldMapping): unknown {
    if (!value) return null;
    let s = String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics
      .replace(/[™®©]/g, '')             // remove trademark/copyright symbols
      .replace(/\s+/g, ' ')
      .trim();
    const max = (config.options?.max as number) ?? 255;
    return s.length > max ? s.slice(0, max) : s;
  },
};
```

```typescript
// clients/cochran/plugins/priceWithMargin.transform.ts
import type { TransformPlugin, CustomFieldMapping } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'priceWithMargin',
  description: 'Apply a percentage margin to a price. Set options.margin in YAML.',

  apply(value, _row, config: CustomFieldMapping): unknown {
    const price  = parseFloat(String(value ?? '0'));
    const margin = (config.options?.margin as number) ?? 0;
    if (isNaN(price)) return null;
    return parseFloat((price * (1 + margin / 100)).toFixed(2));
  },
};
```

### Using plugin rules and transforms in pipeline YAML

```yaml
# Plugin rules: same syntax as built-in rules
dq:
  rules:
    - field: VAT_NUMBER
      checks:
        - { type: ukVatNumber,   severity: warning }
        - { type: notNull,       severity: critical }

    - field: COST_CENTRE
      checks:
        - { type: ifsCostCentre, severity: critical }

# Plugin transforms: type: custom + customOp: <pluginId>
transform:
  fields:
    - from: ACCT_CODE
      to: AccountCode
      type: custom
      customOp: erpAccountFormat

    - from: ORDER_DATE
      to: SeasonCode
      type: custom
      customOp: seasonFromDate

    - from: STYLE_DESC
      to: StyleDesc
      type: custom
      customOp: styleDescClean
      options:
        max: 200             # passed to plugin via config.options

    - from: COST_PRICE
      to: RetailPrice
      type: custom
      customOp: priceWithMargin
      options:
        margin: 65           # 65% margin
```

### Zod schema additions for Tier 2

```typescript
// src/config/schema.ts — additions

// Extend FieldMappingSchema:
const FieldMappingSchema = z.object({
  // ... existing fields ...
  type:      FieldType,           // FieldType enum gains 'custom'
  customOp:  z.string().optional(),   // ← NEW: required when type === 'custom'
  options:   z.record(z.unknown()).optional(),  // ← NEW: arbitrary plugin config
}).refine(
  m => m.type !== 'custom' || !!m.customOp,
  { message: 'type: custom requires customOp to be set', path: ['customOp'] }
);

// Add 'custom' to FieldType enum:
const FieldType = z.enum([
  'string', 'number', 'decimal', 'boolean', 'date',
  'lookup', 'concat', 'constant', 'expression',
  'custom',   // ← NEW
]);
```

### Changes to DQ engine  (src/dq/engine.ts)

```typescript
// DQEngine now accepts a RuleRegistry alongside the built-in rules.
// Resolution order: built-in rules first, then registry lookup.

class DQEngine {
  constructor(
    private readonly builtInRules: Map<string, Rule>,
    private readonly registry: RuleRegistry,   // ← NEW parameter
  ) {}

  private resolveRule(type: string): Rule | RulePlugin | undefined {
    return this.builtInRules.get(type) ?? this.registry.get(type);
  }

  // In the validation loop:
  // const handler = this.resolveRule(check.type);
  // if (!handler) throw new ConfigError(`Unknown rule type "${check.type}". ` +
  //   `Check built-in rules and loaded plugins. Available: ${this.listAll().join(', ')}`);
}
```

### Changes to transform engine  (src/transform/engine.ts)

```typescript
// TransformEngine now accepts a TransformRegistry.

class TransformEngine {
  constructor(
    private readonly registry: TransformRegistry,  // ← NEW parameter
    private readonly lookupResolver: LookupResolver,
    // ...
  ) {}

  private async applyMapping(
    mapping: FieldMapping,
    row: Record<string, unknown>
  ): Promise<unknown> {
    if (mapping.type === 'custom') {
      const plugin = this.registry.get(mapping.customOp!);
      if (!plugin) {
        throw new ConfigError(
          `Unknown customOp "${mapping.customOp}". ` +
          `Available transform plugins: ${this.registry.list().join(', ')}`
        );
      }
      return plugin.apply(row[mapping.from as string], row, mapping as CustomFieldMapping);
    }
    // ... existing type handling ...
  }
}
```

---

## ═══════════════════════════════════════════════════════════
## TIER 3 — NPM PACKAGES
## ═══════════════════════════════════════════════════════════

### Concept

Once plugins prove useful across multiple clients, promote them to scoped npm
packages under `@caracal-lynx/`. Each package exports a `register()` function.
Packages are declared in `sluice.config.yaml` at the project root.

> **Note:** `@caracal-lynx/etl-rules-uk` and `@caracal-lynx/etl-rules-fashion` are private paid packages published from the separate `caracal-lynx/sluice-rules` monorepo — they are **not** part of the public `caracal-lynx/sluice` repository. The public repo contains only `packages/core`.

### Project-level config  (sluice.config.yaml)

```yaml
# sluice.config.yaml
# Lives in the project root alongside package.json.
# Controls npm plugin packages loaded at startup for every pipeline run.

version: "1.0"

plugins:
  # UK-specific validation rules
  - package: "@caracal-lynx/etl-rules-uk"
    options:
      strictVat: false           # passed to register() in the package

  # Fashion / apparel domain rules and transforms
  - package: "@caracal-lynx/etl-rules-fashion"

  # IFS ERP-specific field formatters
  - package: "@caracal-lynx/etl-transform-ifs"

  # BlueCherry ERP-specific field formatters
  - package: "@caracal-lynx/etl-transform-bluecherry"
```

### npm package structure

Each package follows this structure:

```
@caracal-lynx/etl-rules-uk/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts             ← exports register()
    ├── rules/
    │   ├── ukVatNumber.ts
    │   ├── ukNiNumber.ts
    │   ├── ukSortCode.ts
    │   ├── ukPostcode.ts    ← promoted from built-in to package
    │   └── ukCompanyNo.ts
    └── transforms/
        └── ukPhoneFormat.ts
```

```typescript
// @caracal-lynx/etl-rules-uk/src/index.ts

import type { PluginPackage, RuleRegistry, TransformRegistry } from '@caracal-lynx/sluice';
import { ukVatNumber }  from './rules/ukVatNumber';
import { ukNiNumber }   from './rules/ukNiNumber';
import { ukSortCode }   from './rules/ukSortCode';
import { ukCompanyNo }  from './rules/ukCompanyNo';
import { ukPhoneFormat } from './transforms/ukPhoneFormat';

export const plugin: PluginPackage = {
  register(
    rules:      RuleRegistry,
    transforms: TransformRegistry,
    options?:   Record<string, unknown>
  ): void {
    rules.register(ukVatNumber);
    rules.register(ukNiNumber);
    rules.register(ukSortCode);
    rules.register(ukCompanyNo);
    transforms.register(ukPhoneFormat);
  }
};
```

### Loading npm plugins  (src/plugins/loader.ts — additions)

```typescript
export async function loadNpmPlugins(
  configPath: string,
  rules:      RuleRegistry,
  transforms: TransformRegistry
): Promise<void> {
  if (!fs.existsSync(configPath)) return;  // config file is optional

  const raw    = yaml.load(fs.readFileSync(configPath, 'utf8'));
  const config = ToolkitConfigSchema.parse(raw);

  for (const entry of config.plugins ?? []) {
    try {
      const pkg = await import(entry.package);
      const pluginExport: PluginPackage = pkg.plugin ?? pkg.default;
      if (typeof pluginExport?.register !== 'function') {
        throw new Error(`Package "${entry.package}" must export plugin.register()`);
      }
      pluginExport.register(rules, transforms, entry.options);
      logger.info({ package: entry.package }, 'Loaded npm plugin package');
    } catch (err) {
      throw new ConfigError(`Failed to load plugin package "${entry.package}": ${err}`);
    }
  }
}
```

### Zod schema for toolkit config

```typescript
// src/config/schema.ts — additions

export const ToolkitConfigSchema = z.object({
  version: z.string(),
  plugins: z.array(z.object({
    package: z.string(),
    options: z.record(z.unknown()).optional(),
  })).default([]),
});

export type ToolkitConfig = z.infer<typeof ToolkitConfigSchema>;
// Used to parse sluice.config.yaml at startup.
```

### Suggested package roadmap

| Package | Rules | Transforms |
|---|---|---|
| `@caracal-lynx/etl-rules-uk` | `ukVatNumber`, `ukNiNumber`, `ukSortCode`, `ukCompanyNo`, `ukPostcode` | `ukPhoneFormat`, `ukPostcodeNormalise` |
| `@caracal-lynx/etl-rules-fashion` | `seasonCode`, `colourCode`, `sizeCode`, `eanBarcode` | `seasonFromDate`, `styleDescClean`, `colourNameNormalise` |
| `@caracal-lynx/etl-transform-ifs` | `ifsCostCentre`, `ifsGlAccount` | `erpAccountFormat`, `ifsDateFormat`, `ifsYesNo` |
| `@caracal-lynx/etl-transform-bluecherry` | (none yet) | `bcStyleNo`, `bcVendorNo`, `bcSeasonCode` |

---

## ═══════════════════════════════════════════════════════════
## RUNNER CHANGES  (src/runner.ts)
## ═══════════════════════════════════════════════════════════

Plugin loading happens before Phase 1 (config load) and the registries are
threaded through to the DQ and transform engines.

```typescript
export async function runPipeline(
  yamlPath:         string,
  cliOverrides?:    Partial<RunConfig>
): Promise<RunResult> {

  // ── 0. Initialise registries ────────────────────────────
  const ruleRegistry      = new RuleRegistry();
  const transformRegistry = new TransformRegistry();

  // ── 0a. Load npm plugin packages (sluice.config.yaml) ─
  const toolkitConfigPath = path.join(process.cwd(), 'sluice.config.yaml');
  await loadNpmPlugins(toolkitConfigPath, ruleRegistry, transformRegistry);

  // ── 0b. Load plugin files from client plugins/ folder ───
  const pluginDir = path.join(path.dirname(yamlPath), 'plugins');
  await loadPlugins(pluginDir, ruleRegistry, transformRegistry);

  // ── 1. Load + validate config (with composite rule expansion) ─
  const config = await ConfigLoader.load(yamlPath, cliOverrides);

  // ── 2-15. Existing phases, but engines receive registries ──
  const dqEngine        = new DQEngine(builtInRules, ruleRegistry);
  const transformEngine = new TransformEngine(transformRegistry, lookupResolver);

  // ... rest of runner unchanged ...
}
```

---

## ═══════════════════════════════════════════════════════════
## CLI ADDITIONS
## ═══════════════════════════════════════════════════════════

```
sluice plugins                   List all loaded rule and transform plugins

New global option:
  --plugins <dir>                Additional plugin directory to load
                                 (in addition to the pipeline's own plugins/)
```

`sluice plugins` output:

```
Loaded rule plugins (12):
  ├─ eribeSeasonCode         Eribé custom season code validation
  ├─ bcInventoryLocation     Business Central inventory location rules
  └─ ...

Loaded transform plugins (8):
  ├─ eribeStyleTransform     Eribé style mapping (old → new format)
  ├─ wmsNormaliseQty         Normalise WMS quantity decimals
  └─ ...
```

---

## ═══════════════════════════════════════════════════════════
## UPDATED YAML SPEC ADDITIONS
## ═══════════════════════════════════════════════════════════

The following keys are new in Phase 3. Add them to the CLAUDE.md YAML spec.

### `dq` section — new keys

```yaml
dq:
  rulesFile: ../../shared/rules.yaml   # Path to composite rule library.
                                       # Resolved relative to the pipeline YAML.
```

### `transform.fields` — new keys for custom operations

```yaml
transform:
  fields:
    - from: SOURCE_FIELD
      to: TARGET_FIELD
      type: custom                     # Delegates to a TransformPlugin.
      customOp: myPluginId             # REQUIRED when type: custom.
      options:                         # Optional. Passed to plugin.apply() as
        margin: 65                     # config.options. Any key/value pairs.
        max: 200
```

### Updated FieldType enum

```
string | number | decimal | boolean | date |
lookup | concat | constant | expression | custom
```

---

## ═══════════════════════════════════════════════════════════
## TESTING
## ═══════════════════════════════════════════════════════════

### New test files

```
tests/
├── unit/
│   ├── plugins/
│   │   ├── loader.test.ts
│   │   ├── registry.test.ts
│   │   └── composite-expansion.test.ts
│   └── rules/
│       ├── ukVatNumber.test.ts
│       ├── ukNiNumber.test.ts
│       └── ifsCostCentre.test.ts
└── fixtures/
    ├── plugins/
    │   ├── testRule.rule.ts            ← fixture plugin for loader tests
    │   └── testTransform.transform.ts
    └── shared-rules.yaml              ← fixture composite rule library
```

### Required test cases

**RuleRegistry:**
- Register a plugin and retrieve by id
- Duplicate id throws `ConfigError`
- `list()` returns all registered ids
- `has()` returns false for unknown id

**TransformRegistry:**
- Same tests as RuleRegistry

**Plugin loader:**
- Discovers `*.rule.ts` files in plugins directory
- Discovers `*.transform.ts` files in plugins directory
- Non-existent plugins directory is silently ignored
- Malformed plugin file (missing `rule` export) throws `ConfigError`
- Plugin registered successfully is callable via registry

**Composite rule expansion:**
- Single composite rule expanded to its constituent checks
- Composite rule with severity override applies override to all expanded checks
- Mixed composite + built-in checks in same field rule both work
- Unknown composite rule id throws `ConfigError` with helpful message
- `rulesFile` path that does not exist throws `ConfigError`
- Valid `rulesFile` parses against `CompositeRuleLibrarySchema`

**DQ engine with custom rules:**
- Custom rule invoked when type matches plugin id
- Unknown rule type throws `ConfigError` listing available rules
- Plugin violation correctly captured in rejection report

**Transform engine with custom operations:**
- `type: custom` + `customOp` delegates to correct plugin
- `options` are passed through to `plugin.apply()`
- Unknown `customOp` throws `ConfigError` listing available transforms
- Plugin returning null handled correctly per `optional` flag

**npm plugin loading:**
- Valid `sluice.config.yaml` loads package and calls `register()`
- Missing config file silently ignored
- Package without `plugin.register` export throws `ConfigError`

**ukVatNumber rule:**
- `GB123456789` → valid
- `GB123456789012` → valid
- `GBGD123` → valid
- `GBHA123` → valid
- `123456789` (no GB prefix) → violation
- `GB12345678` (8 digits) → violation
- Empty string → null (notNull handles this)
- Null → null

**ifsCostCentre rule:**
- Known cost centre → valid
- Unknown cost centre → violation with list of valid codes

**erpAccountFormat transform:**
- `"1234"` → `"ACC-001234"`
- `"ACC001234"` (already formatted) → `"ACC-001234"`
- Null → null

**seasonFromDate transform:**
- `"2026-03-15"` (March) → `"SS26"`
- `"2026-09-01"` (September) → `"AW26"`
- `"2025-01-31"` (January) → `"AW25"` (Jan is AW of prior year)
- Invalid date string → null

**priceWithMargin transform:**
- `100` with `margin: 65` → `165.00`
- `"49.99"` with `margin: 100` → `"99.98"`
- Non-numeric → null

---

## ═══════════════════════════════════════════════════════════
## BUILD ORDER FOR CLAUDE CODE
## ═══════════════════════════════════════════════════════════

Phase 3 requires Phases 1 and 2 to be complete and all prior tests passing.
Work sub-phase by sub-phase; do not proceed until tests pass.

1. **Registry classes** — `src/plugins/registry.ts` + `src/plugins/types.ts`.
   Unit tests only; no loader yet.

2. **Composite rule expansion** — extend `src/config/loader.ts` to resolve
   `dq.rulesFile` and expand composite rule references before Zod parse.
   Add `CompositeRuleSchema` + `CompositeRuleLibrarySchema` to `schema.ts`.
   Add `rulesFile` to `DqSchema`.
   Tests: fixture `shared-rules.yaml` expands correctly.

3. **Plugin file loader** — `src/plugins/loader.ts`. Auto-discover `*.rule.ts`
   and `*.transform.ts` in a given directory.
   Tests: fixture plugin files loaded and registered correctly.

4. **DQ engine extension** — pass `RuleRegistry` to `DQEngine`. Resolve custom
   rule types from registry after built-in lookup fails.
   Tests: custom rule fires correctly; unknown type throws with helpful message.

5. **Transform engine extension** — pass `TransformRegistry` to `TransformEngine`.
   Handle `type: custom` + `customOp`. Pass `options` to plugin.
   Tests: custom transform applied correctly; `options` passed through.

6. **Runner wiring** — update `PipelineRunner` to initialise registries, load npm
   plugins, load file plugins, and pass registries to both engines.

7. **npm plugin loading** — `loadNpmPlugins()` in loader.ts + `ToolkitConfigSchema`.
   Tests: mock import resolves correctly; bad package throws `ConfigError`.

8. **CLI additions** — `sluice plugins` command + `--plugins` flag.

9. **Example plugins** — implement the four example plugins above as real files in
   `clients/cochran/plugins/` and `clients/eribe/plugins/`. All tests pass.

10. **Package scaffolding** — create `packages/etl-rules-uk/` monorepo member with
    `ukVatNumber`, `ukNiNumber`, and `ukSortCode`. Wire into workspace with
    `npm workspaces`. Do not publish to npm yet.
    > **Note:** This step applies to the **private** `caracal-lynx/sluice-rules` monorepo, not the public `caracal-lynx/sluice` monorepo. The public repo contains only `packages/core`.

---

## ═══════════════════════════════════════════════════════════
## WHAT NOT TO DO (Phase 3 additions)
## ═══════════════════════════════════════════════════════════

- Do not allow plugins to perform I/O (file reads, HTTP calls, DB queries).
  Plugin `validate()` and `apply()` must be pure synchronous functions.
  If a plugin needs external data (e.g. a list of valid codes), it must
  receive that data via `config.options` — loaded by the runner, not the plugin.
- Do not allow plugins to mutate the source `row` object passed to `apply()`.
  Treat it as read-only.
- Do not auto-register all exports from a plugin file — only the named `rule`
  or `transform` export. Multiple plugins per file are not supported; use one
  file per plugin.
- Do not let composite rule expansion be recursive (composite rules referencing
  other composite rules). Expansion is one level deep only.
- Do not shadow built-in rule ids in plugins
  (e.g. a plugin with id `notNull` would mask the built-in). The registry
  throws `ConfigError` on duplicate registration regardless of source.
- Do not add `async` to plugin `validate()` or `apply()` methods.
  All plugin execution is synchronous. Async plugin support is a non-goal.

---

*This file specifies Sluice Phase 3 (Plugin System) only. Read CLAUDE.md for the Phase 1 baseline.
Both files must be in the project root when working on Phase 3.*
