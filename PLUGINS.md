# Sluice Plugin Development Guide

Welcome! This guide will help you create custom data quality rules and transform operations for Sluice pipelines.

## Overview

Plugins extend Sluice with custom functionality without modifying the core engine. There are two types:

| Type | Purpose | File Pattern | Usage |
|------|---------|--------------|-------|
| **Rule Plugin** | Custom DQ validation logic | `*.rule.{ts,js}` | `type: <rule-id>` in DQ config |
| **Transform Plugin** | Custom field transformation | `*.transform.{ts,js}` | `type: custom` + `customOp: <id>` |
| **Merge Strategy Plugin** | Custom multi-source merge strategy | `*.merge.{ts,js}` | `merge.strategy: <strategy-id>` |

## Plugin Loading

Plugins are discovered and loaded in two tiers:

### Tier 2: File-Based Plugins

Place plugin files in your project's `plugins/` directory:

```
your-project/
├── pipeline.yaml
├── .env
└── plugins/
    ├── my-validator.rule.ts          # Custom DQ rule
    └── my-transformer.transform.ts   # Custom transform
```

When you run a pipeline, Sluice automatically scans this directory and loads all `*.rule.ts`, `*.rule.js`, `*.transform.ts`, and `*.transform.js` files.

### Tier 3: NPM Package Plugins

Declare npm packages in `sluice.config.yaml`:

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

Each package must export a `plugin` or `default` object with a `register()` function.

### Viewing Loaded Plugins

```bash
sluice plugins

# Include additional plugin directories
sluice plugins --plugins ./shared/plugins ./team/plugins
```

If multiple plugin paths resolve to the same absolute directory (for example,
`./plugins` and an equivalent absolute path), Sluice loads that directory once.

Output:
```
📋 Data Quality Rules:
  • my-validator
  • strict-email

🔄 Transform Operations:
  • my-transformer
  • slug-generator

🔀 Merge Strategies:
  • coalesce
  • union
  • my-custom-merge
```

---

## Creating a Rule Plugin

### Basic Structure

```typescript
// my-rule.rule.ts
import type { RulePlugin, RuleViolation } from '@caracal-lynx/sluice';
import type { CheckConfig } from '@caracal-lynx/sluice';

export const rule: RulePlugin = {
  id: 'my-rule-id',                          // Must be unique
  validate(value, config, rowIndex, field) {
    // Return null if valid, or a RuleViolation if invalid
    if (isValid(value)) return null;
    
    return {
      field,
      rowIndex,
      value,
      rule: 'my-rule-id',
      severity: config.severity,              // 'critical' | 'warning' | 'info'
      message: config.message ?? 'Custom validation failed',
    };
  },
};
```

### Example: Phone Number Validator

```typescript
// phone-validator.rule.ts
import type { RulePlugin } from '@caracal-lynx/sluice';
import type { CheckConfig } from '@caracal-lynx/sluice';

// UK phone number pattern (simplified)
const UK_PHONE = /^(?:\+44\s?7\d{3}|01\d{3,4})[\s-]?\d{3,4}[\s-]?\d{3,4}$/;

export const rule: RulePlugin = {
  id: 'uk-phone',
  validate(value, config, rowIndex, field) {
    if (value === null || value === undefined || value === '') return null;

    const phone = String(value).trim();
    
    if (!UK_PHONE.test(phone)) {
      return {
        field,
        rowIndex,
        value,
        rule: 'uk-phone',
        severity: config.severity,
        message: config.message ?? `"${phone}" is not a valid UK phone number`,
      };
    }

    return null;
  },
};
```

### Using in a Pipeline

```yaml
dq:
  stopOnCritical: false
  rules:
    - field: PhoneNumber
      checks:
        - type: uk-phone
          severity: warning
          message: "Invalid UK phone format"
```

---

## Creating a Transform Plugin

### Basic Structure

```typescript
// my-transform.transform.ts
import type { TransformPlugin } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'my-transform-id',
  apply(value, row, config) {
    // Return transformed value, or null
    if (value === null || value === undefined) return null;
    
    // Use options if provided
    const setting = config.options?.['someSetting'];
    
    return transformedValue;
  },
};
```

### Example: Title Case Transformer

```typescript
// title-case.transform.ts
import type { TransformPlugin } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'title-case',
  apply(value, _row, config) {
    if (value === null || value === undefined) return null;

    const str = String(value).trim();
    if (str === '') return null;

    // Optionally preserve all-caps acronyms
    const preserveAcronyms = (config.options?.['preserveAcronyms'] as boolean) ?? false;

    return str
      .split(/\s+/)
      .map((word) => {
        if (preserveAcronyms && word.length > 1 && word === word.toUpperCase()) {
          return word; // Keep "USA", "IBM", etc. as-is
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  },
};
```

### Using in a Pipeline

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

### Example: Credit Card Masker (with Row Context)

```typescript
// mask-credit-card.transform.ts
import type { CustomFieldMapping, TransformPlugin } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'mask-cc',
  apply(value) {
    if (value === null || value === undefined) return null;

    const cc = String(value).replace(/\D/g, '');
    if (cc.length < 8) return value; // Not a card number

    // Mask: show last 4 digits only
    const masked = '*'.repeat(cc.length - 4) + cc.slice(-4);
    return masked;
  },
};
```

---

## Creating a Merge Strategy Plugin

Merge strategy plugins allow custom merge logic for multi-source pipelines.

```typescript
// weighted-merge.merge.ts
import type { MergeStrategyPlugin } from '@caracal-lynx/sluice';

export const mergeStrategy: MergeStrategyPlugin = {
  id: 'weighted-merge',
  description: 'Example merge strategy plugin',
  async merge(store, sources, config) {
    // Your strategy can create/update stg_merged using the staging store.
    // Most strategies delegate SQL generation to your merge helpers.
    // This example returns a stub result.
    return {
      rowsMerged: 0,
      conflicts: 0,
      unmatched: 0,
      tableName: 'stg_merged',
    };
  },
};
```

Usage in pipeline:

```yaml
merge:
  key: STYLE_NO
  strategy: weighted-merge
  onUnmatched: include
```

File naming convention: `*.merge.ts` or `*.merge.js`.

---

## Error Handling

### Rule Plugins

Return a `RuleViolation` if validation fails; return `null` if valid. Exceptions are caught and treated as validation failures.

```typescript
export const rule: RulePlugin = {
  id: 'safe-parser',
  validate(value, config, rowIndex, field) {
    try {
      const parsed = JSON.parse(String(value));
      return null; // Valid JSON
    } catch {
      return {
        field,
        rowIndex,
        value,
        rule: 'safe-parser',
        severity: config.severity,
        message: 'Value is not valid JSON',
      };
    }
  },
};
```

### Transform Plugins

Throw an error if the transformation cannot proceed. The pipeline will halt or continue depending on `run.onError`.

```typescript
export const transform: TransformPlugin = {
  id: 'json-extractor',
  apply(value, _row, config) {
    if (value === null) return null;

    try {
      const obj = JSON.parse(String(value));
      const key = config.options?.['key'] as string;
      if (!key) throw new Error('Missing required option: key');
      return obj[key] ?? null;
    } catch (err) {
      throw new Error(`json-extractor: ${String(err)}`);
    }
  },
};
```

---

## Options & Configuration

Transform plugins receive an `options` object passed from the pipeline config. Always provide sensible defaults:

```typescript
export const transform: TransformPlugin = {
  id: 'configurable-op',
  apply(value, _row, config) {
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

Usage in pipeline:

```yaml
transform:
  fields:
    - from: description
      to: slug
      type: custom
      customOp: configurable-op
      options:
        maxLength: 50
        separator: "_"
        lowercase: false
```

---

## Testing Plugins

### Testing Rule Plugins

```typescript
import { describe, it, expect } from 'vitest';
import { rule as ukPhone } from './phone-validator.rule';

describe('uk-phone rule', () => {
  it('should accept valid UK phone numbers', () => {
    const result = ukPhone.validate('+447700900000', { severity: 'warning' }, 0, 'phone');
    expect(result).toBeNull();
  });

  it('should reject invalid phone numbers', () => {
    const result = ukPhone.validate('12345', { severity: 'warning' }, 0, 'phone');
    expect(result).not.toBeNull();
    expect(result?.message).toContain('not a valid');
  });

  it('should skip null values', () => {
    const result = ukPhone.validate(null, { severity: 'warning' }, 0, 'phone');
    expect(result).toBeNull();
  });
});
```

### Testing Transform Plugins

```typescript
import { describe, it, expect } from 'vitest';
import { transform as titleCase } from './title-case.transform';

describe('title-case transform', () => {
  it('should convert to title case', async () => {
    const result = await titleCase.apply('hello world');
    expect(result).toBe('Hello World');
  });

  it('should preserve acronyms when requested', async () => {
    const result = await titleCase.apply('USA', { preserveAcronyms: true });
    expect(result).toBe('USA');
  });

  it('should return null for empty strings', async () => {
    const result = await titleCase.apply('', {});
    expect(result).toBeNull();
  });
});
```

---

## Packaging NPM Plugins

### Package Structure

```
sluice-my-rules/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Main export
│   ├── rules/
│   │   ├── my-rule.ts
│   │   └── another-rule.ts
│   └── transforms/
│       ├── my-transform.ts
│       └── another-transform.ts
├── tests/
│   ├── rules.test.ts
│   └── transforms.test.ts
└── dist/                     # Compiled JavaScript
```

### Package.json

```json
{
  "name": "@caracal-lynx/sluice-domain-validators",
  "version": "1.0.0",
  "description": "Sluice plugins for domain-specific validation",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "dependencies": {
    "@caracal-lynx/sluice": "^0.1.0"
  }
}
```

### Index Export (src/index.ts)

```typescript
import type { RuleRegistry, TransformRegistry } from '@caracal-lynx/sluice';
import { rule as emailRule } from './rules/email.js';
import { rule as phoneRule } from './rules/phone.js';
import { transform as slugTransform } from './transforms/slug.js';

export function register(
  ruleRegistry: RuleRegistry,
  transformRegistry: TransformRegistry,
): void {
  ruleRegistry.register(emailRule);
  ruleRegistry.register(phoneRule);
  transformRegistry.register(slugTransform);
}

export default { register };
```

### Usage in Client Project

Add to `sluice.config.yaml`:

```yaml
version: "1.0"
plugins:
  - package: "@caracal-lynx/sluice-domain-validators"
```

Install:

```bash
npm install @caracal-lynx/sluice-domain-validators
```

---

## Best Practices

### 1. **Handle null/undefined consistently**

```typescript
// ✅ Good
if (value === null || value === undefined) return null;

// ❌ Avoid
if (!value) return null;  // Breaks for 0, false, empty string
```

### 2. **Provide clear error messages**

```typescript
// ✅ Good
message: `"${value}" does not match expected format: ${pattern}`

// ❌ Avoid
message: 'Invalid'
```

### 3. **Use TypeScript strict mode**

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### 4. **Document options with examples**

```typescript
export const transform: TransformPlugin = {
  id: 'example',
  /**
   * Transform with configurable options.
   *
   * Options:
   *   - maxLength (number, default 100): truncate after N chars
   *   - separator (string, default '-'): word separator
   *   - lowercase (boolean, default true): convert to lowercase
   *
   * Example:
   *   type: custom
   *   customOp: example
   *   options:
   *     maxLength: 50
   *     separator: "_"
   */
  apply: async (value, options) => {
    // ...
  },
};
```

### 5. **Test edge cases**

```typescript
it('should handle unicode characters', async () => {
  const result = await transform.apply('Café', {});
  expect(result).toBeDefined();
});

it('should handle very long strings', async () => {
  const longStr = 'a'.repeat(10000);
  const result = await transform.apply(longStr, {});
  expect(result).toBeDefined();
});
```

---

## Advanced: Plugin with External Dependencies

```typescript
// geocode.transform.ts
import axios from 'axios';
import type { TransformPlugin } from '@caracal-lynx/sluice';

export const transform: TransformPlugin = {
  id: 'geocode-address',
  apply: async (value, options) => {
    if (value === null || value === undefined) return null;

    const address = String(value).trim();
    if (address === '') return null;

    const apiKey = options?.apiKey as string;
    if (!apiKey) throw new Error('geocode: missing required option apiKey');

    try {
      const response = await axios.get('https://api.example.com/geocode', {
        params: { address, key: apiKey },
        timeout: 5000,
      });

      return response.data.coordinates ?? null;
    } catch (err) {
      throw new Error(`geocode: ${String(err)}`);
    }
  },
};
```

---

## Troubleshooting

### Plugin Not Loading?

1. Check file naming: must end with `.rule.ts`, `.rule.js`, `.transform.ts`, or `.transform.js`
2. Verify `plugins/` directory exists at `{project-root}/plugins/`
3. Run `sluice plugins` to see discovered plugins
4. Check logs: `sluice run --log-level debug pipeline.yaml`

### Plugin ID Not Recognized?

1. Ensure the `id` field is set in the plugin export
2. Run `sluice plugins` to verify it was registered
3. Check for duplicate IDs across plugins

### Plugin Crashes During Execution?

1. Wrap logic in try-catch with informative error messages
2. Test independently: create a simple TypeScript file that imports and calls your plugin
3. Check `run.onError` setting in pipeline (`continue` vs `stop`)

---

## Examples Repository

Real-world examples:
- [`sluice-plugins-examples`](https://github.com/caracal-lynx/sluice-plugins-examples) — Common validators and transforms
- [`sluice-erp-validators`](https://github.com/caracal-lynx/sluice-erp-validators) — ERP-specific rules (IFS, BC, BlueCherry)

---

## Questions?

File an issue or reach out to the Sluice team. Happy extending! 🚀
