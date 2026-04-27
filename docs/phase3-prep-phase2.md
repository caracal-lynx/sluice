# Sluice — Phase 3 Preparation Work for Phase 2
# Implementation instructions for Claude Code
# Author: Michael Scott, Caracal Lynx Limited
# Date: 2026-04-17

---

## Purpose

These are targeted changes that must be made **during Phase 2** to complete
the groundwork for Phase 3's multi-source merge feature. Phase 2 introduces
the plugin system; Phase 3 preparation work here involves adding the
`MergeStrategyPlugin` interface to that system, and migrating the Zod schema
to support multi-source YAML pipelines so they can be validated (even though
the runner cannot execute them until Phase 3).

Read `docs/phase3-multi-source-merge.md` for full context.
Read `docs/phase3-prep-phase1.md` to confirm Phase 1 prep is complete before
starting Phase 2 — the changes here build on Phase 1's foundations.

---

## Prerequisite checks

Before starting Phase 2 prep work, verify Phase 1 changes are in place:

```typescript
// These must already be true:
// 1. ExtractResult.tableName is `string` (not `'stg_raw'`)
// 2. SourceAdapter.extract() has optional targetTable parameter
// 3. DqRuleSchema has sourceId?: string
// 4. DQEngine.run() has tableName parameter (defaults to 'stg_raw')
// 5. TransformEngine.run() has sourceTable/targetTable parameters
// 6. PipelineRunner has protected phase methods
```

If any of these are missing, implement them from `docs/phase3-prep-phase1.md`
first.

---

## Change 1 — `src/config/schema.ts`: add multi-source schemas

### Why

The config loader and schema module are Phase 2 concerns (they will be
extended by the plugin system). Adding the multi-source schema types now
means:

- Multi-source YAML files can be validated with `sluice check` or
  `sluice validate` even before Phase 3 is built.
- Phase 3 has no Zod breaking changes to make.
- Config loader tests for multi-source YAML can be written and pass in
  Phase 2.

### What to add

Add the following to `src/config/schema.ts` after the existing schemas.
Do **not** modify any existing schema — only add new ones and extend
`PipelineSchema`.

```typescript
// ── Multi-source merge schemas ────────────────────────────────────────────

const MergeFieldStrategySchema = z.object({
  field:    z.string(),
  strategy: z.enum(['coalesce', 'priority-override']).optional(),
  source:   z.string().optional(),    // named source id; always-take from here
}).refine(
  s => s.strategy || s.source,
  { message: 'fieldStrategy must specify strategy, source, or both' }
);

export const MergeSchema = z.object({
  key:               z.union([z.string(), z.array(z.string())]),
  strategy:          z.enum(['coalesce', 'priority-override', 'union', 'intersect'])
                       .default('coalesce'),
  onUnmatched:       z.enum(['include', 'exclude', 'warn', 'error'])
                       .default('include'),
  fieldStrategies:   z.array(MergeFieldStrategySchema).default([]),
  conflictLog:       z.string().optional(),
  incrementalSource: z.string().optional(),
});

// MultiSourceEntrySchema extends SourceSchema with the multi-source-only fields.
// Using .extend() preserves all source adapter validations.
export const MultiSourceEntrySchema = SourceSchema.extend({
  id:       z.string().regex(/^[a-z0-9-]+$/, {
              message: 'source id must be lowercase alphanumeric with hyphens only'
            }),
  priority: z.number().int().min(1),
  rename:   z.record(z.string()).optional(),
  // rename: flat map of { 'old column name': 'new column name' }
  // Applied immediately after extract, before per-source DQ rules and merge.
  // SQL/REST sources normalise column names in the query/field selection.
  // rename is intended for CSV and Excel sources where headers are fixed.
  // Unknown keys (columns not in the extracted data) produce a warning, not an error.
});

export type MergeConfig        = z.infer<typeof MergeSchema>;
export type MultiSourceEntry   = z.infer<typeof MultiSourceEntrySchema>;
```

### What to change in `PipelineSchema`

Replace the current `PipelineSchema` definition with one that accepts either
`source` (single) or `sources` + `merge` (multi), but not both:

```typescript
// BEFORE
export const PipelineSchema = z.object({
  pipeline:  z.object({ ... }),
  source:    SourceSchema,
  dq:        DqSchema,
  transform: TransformSchema,
  target:    TargetSchema,
  run:       RunSchema.default({}),
});

// AFTER
export const PipelineSchema = z.object({
  pipeline:  z.object({
    name:        z.string().regex(/^[a-z0-9-]+$/),
    client:      z.string(),
    version:     z.string(),
    entity:      z.string(),
    description: z.string().optional(),
  }),
  // Single-source (existing)
  source:    SourceSchema.optional(),
  // Multi-source (Phase 3)
  sources:   z.array(MultiSourceEntrySchema).min(2).optional(),
  merge:     MergeSchema.optional(),
  // Shared
  dq:        DqSchema,
  transform: TransformSchema,
  target:    TargetSchema,
  run:       RunSchema.default({}),
}).refine(
  s => {
    const hasSingle = !!s.source;
    const hasMulti  = !!s.sources && !!s.merge;
    return (hasSingle && !s.sources && !s.merge) ||
           (!hasSingle && hasMulti);
  },
  {
    message: 'pipeline must have either source (single) or both sources and merge (multi)',
  }
).refine(
  s => {
    // If multi-source and incremental mode, incrementalSource must be set
    if (s.sources && s.run?.mode === 'incremental') {
      return !!s.merge?.incrementalSource;
    }
    return true;
  },
  {
    message: 'merge.incrementalSource is required when run.mode is incremental',
  }
).refine(
  s => {
    // If multi-source, incrementalSource must match one of the source ids
    if (s.sources && s.merge?.incrementalSource) {
      const ids = s.sources.map(src => src.id);
      return ids.includes(s.merge.incrementalSource);
    }
    return true;
  },
  {
    message: 'merge.incrementalSource must match the id of one of the declared sources',
  }
);

// Update Pipeline type — source is now optional
export type Pipeline = z.infer<typeof PipelineSchema>;

// Convenience type guards (add to src/config/types.ts)
export function isSingleSource(p: Pipeline): p is Pipeline & { source: SourceConfig } {
  return !!p.source;
}
export function isMultiSource(p: Pipeline): p is Pipeline & {
  sources: MultiSourceEntry[];
  merge: MergeConfig;
} {
  return !!p.sources && !!p.merge;
}
```

### Update `src/config/types.ts`

Re-export the new types from the barrel:

```typescript
export type {
  Pipeline,
  SourceConfig,
  TargetConfig,
  RunConfig,
  FieldMapping,
  DqRule,
  Lookup,
  MergeConfig,        // NEW
  MultiSourceEntry,   // NEW
} from './schema';

export {
  isSingleSource,     // NEW
  isMultiSource,      // NEW
} from './schema';
```

### Update `PipelineRunner` to guard against multi-source execution

`PipelineRunner` in Phase 2 cannot execute multi-source pipelines (Phase 3
is not built yet). Add an early guard so the error is clear rather than a
crash:

```typescript
// In PipelineRunner.run():
async run(yamlPath: string): Promise<RunResult> {
  const config = await ConfigLoader.load(yamlPath);

  if (isMultiSource(config)) {
    throw new ConfigError(
      'Multi-source pipelines require Phase 3 (MultiSourcePipelineRunner). ' +
      'This pipeline declares sources + merge and cannot be run with sluice run yet.'
    );
  }

  // ... existing single-source logic
}
```

This means `sluice check my-multi-source.yaml` works (validates the schema),
but `sluice run my-multi-source.yaml` throws a clear, actionable error.

### Config loader tests to add

```typescript
// tests/unit/config/multi-source.test.ts

describe('multi-source schema validation', () => {

  it('parses a valid multi-source pipeline', () => {
    // Load tests/fixtures/style-co-products-merged.pipeline.yaml
    // (add this fixture — see fixture spec below)
    // Expect: no ZodError; isMultiSource(result) === true
  });

  it('rejects pipeline with both source and sources', () => {
    // YAML has both source: and sources: keys
    // Expect: ZodError mentioning 'must have either source or both sources and merge'
  });

  it('rejects sources without merge', () => {
    // YAML has sources: but no merge:
    // Expect: ZodError
  });

  it('rejects merge without sources', () => {
    // YAML has merge: but no sources:
    // Expect: ZodError
  });

  it('rejects incremental mode without incrementalSource', () => {
    // Multi-source YAML with run.mode: incremental, no merge.incrementalSource
    // Expect: ZodError
  });

  it('rejects incrementalSource that does not match any source id', () => {
    // merge.incrementalSource: 'nonexistent'
    // Expect: ZodError
  });

  it('rejects source id with uppercase letters', () => {
    // sources[0].id: 'SQL-Server'
    // Expect: ZodError
  });

  it('parses a source entry with a rename map', () => {
    // sources[0].rename: { 'Style Number': 'STYLE_NO', Description: 'STYLE_DESC' }
    // Expect: no ZodError; rename map preserved in parsed config
  });

  it('accepts a rename map with space-containing keys', () => {
    // rename: { 'Style Number': 'STYLE_NO' } — spaces are valid in old column names
    // Expect: no ZodError
  });

  it('isSingleSource returns true for single-source pipeline', () => { ... });
  it('isMultiSource returns true for multi-source pipeline', () => { ... });
});
```

### Test fixture to add

Create `tests/fixtures/style-co-products-merged.pipeline.yaml` using the full
example from `docs/phase3-multi-source-merge.md`. This file:
- Must parse cleanly with `ConfigLoader.load()`
- Includes `rename` maps on the `` and `excel` source entries
- Is used in config tests only — no adapter or runner tests in Phase 2

---

## Change 2 — Plugin system: add `MergeStrategyPlugin` interface

### Why

Phase 2 introduces the TypeScript plugin file mechanism (`.plugin.ts` files
alongside YAML configs). The `SourceAdapter` and `TargetAdapter` interfaces
will be the first plugin types. Adding `MergeStrategyPlugin` as a third
plugin type now means:

- Plugin authors can implement custom merge logic (e.g. "average cost price
  across sources") without modifying Sluice core.
- The plugin loader, registry scaffolding, and type system are built once for
  all three plugin types.
- Phase 3 just registers its four built-in strategies against this interface.

### What to add

Create `src/merge/types.ts`:

```typescript
import type { StagingStore } from '@/staging/store';
import type { MergeConfig }  from '@/config/types';

export interface MergeSourceMeta {
  id:        string;
  priority:  number;
  tableName: string;   // e.g. 'stg_raw_sql_server'
}

export interface MergeResult {
  rowsMerged:  number;
  conflicts:   number;   // fields where two non-null values disagreed
  unmatched:   number;   // records present in only one source
  tableName:   'stg_merged';
}

export interface MergeStrategyPlugin {
  readonly id: string;   // matches MergeSchema.strategy value

  /**
   * Merges N source staging tables into stg_merged.
   * Sources are passed in priority order (priority 1 first).
   * The implementation is responsible for creating stg_merged in the store.
   */
  merge(
    store:   StagingStore,
    sources: MergeSourceMeta[],
    config:  MergeConfig,
  ): Promise<MergeResult>;
}
```

### Add `MergeStrategyRegistry` in `src/merge/index.ts`

Follow exactly the same pattern used for `SourceAdapterRegistry` and
`TargetAdapterRegistry`:

```typescript
import type { MergeStrategyPlugin } from './types';
import { ConfigError } from '@/utils/errors';

const registry = new Map<string, MergeStrategyPlugin>();

export const MergeStrategyRegistry = {
  register(plugin: MergeStrategyPlugin): void {
    registry.set(plugin.id, plugin);
  },

  get(id: string): MergeStrategyPlugin {
    const plugin = registry.get(id);
    if (!plugin) {
      throw new ConfigError(
        `No merge strategy registered for id '${id}'. ` +
        `Built-in strategies: coalesce, priority-override, union, intersect.`
      );
    }
    return plugin;
  },

  has(id: string): boolean {
    return registry.has(id);
  },
};
```

The four built-in strategy implementations (`coalesce`, `priority-override`,
`union`, `intersect`) are NOT built in Phase 2. The registry is created and
exported; Phase 3 populates it. This mirrors the pattern where the adapter
registries exist in Phase 1 and the concrete adapters are registered at
startup.

### Update `src/index.ts`

Export the new merge types from the public API barrel:

```typescript
// Add to src/index.ts:
export type { MergeStrategyPlugin, MergeSourceMeta, MergeResult } from './merge/types';
export { MergeStrategyRegistry } from './merge/index';
```

### Plugin loader changes

If Phase 2's plugin loader scans for and instantiates plugin types, extend
it to recognise `MergeStrategyPlugin` exports alongside `SourceAdapter` and
`TargetAdapter`:

```typescript
// In the plugin loader — whatever pattern Phase 2 uses to identify plugin types:

function isMergeStrategyPlugin(export_: unknown): export_ is MergeStrategyPlugin {
  return (
    typeof export_ === 'object' &&
    export_ !== null &&
    typeof (export_ as MergeStrategyPlugin).id === 'string' &&
    typeof (export_ as MergeStrategyPlugin).merge === 'function'
  );
}

// Then in the plugin registration loop:
if (isMergeStrategyPlugin(exported)) {
  MergeStrategyRegistry.register(exported);
}
```

### Tests to add

```typescript
// tests/unit/merge/registry.test.ts

describe('MergeStrategyRegistry', () => {

  it('registers and retrieves a merge strategy plugin', () => {
    const mockStrategy: MergeStrategyPlugin = {
      id: 'test-strategy',
      merge: vi.fn().mockResolvedValue({
        rowsMerged: 0, conflicts: 0, unmatched: 0, tableName: 'stg_merged',
      }),
    };
    MergeStrategyRegistry.register(mockStrategy);
    expect(MergeStrategyRegistry.get('test-strategy')).toBe(mockStrategy);
  });

  it('throws ConfigError for unknown strategy id', () => {
    expect(() => MergeStrategyRegistry.get('nonexistent'))
      .toThrow(ConfigError);
  });

  it('has() returns false before registration', () => {
    expect(MergeStrategyRegistry.has('not-yet-registered')).toBe(false);
  });
});
```

---

## Change 3 — `src/runner.ts`: handle `isMultiSource` guard

This was covered in Change 1 above (the early guard in `PipelineRunner.run()`).
No additional changes to the runner are needed in Phase 2.

---

## Change 4 — Update `sluice check` CLI command

The `check` command validates config only (no execution). It should work
for multi-source pipelines in Phase 2. Verify that `ConfigLoader.load()`
on a multi-source YAML:

1. Resolves `${ENV_VAR}` interpolation in all `sources` entries.
2. Validates against the updated `PipelineSchema` (including the new
   `.refine()` rules).
3. Reports Zod validation errors in the same human-readable format as
   single-source errors.

No code change is needed if the config loader already uses `PipelineSchema`
generically — but add a CLI integration test:

```typescript
// tests/integration/cli-check.test.ts (extend existing file)

it('sluice check accepts a valid multi-source pipeline', async () => {
  const result = await runCLI(['check', 'tests/fixtures/style-co-products-merged.pipeline.yaml']);
  expect(result.exitCode).toBe(0);
});

it('sluice check rejects a multi-source pipeline with no merge section', async () => {
  const result = await runCLI(['check', 'tests/fixtures/multi-source-no-merge.pipeline.yaml']);
  expect(result.exitCode).toBe(3);   // exit code 3 = config error
  expect(result.stderr).toContain('must have either source or both sources and merge');
});

it('sluice run rejects a multi-source pipeline with a clear error', async () => {
  const result = await runCLI(['run', 'tests/fixtures/style-co-products-merged.pipeline.yaml']);
  expect(result.exitCode).toBe(3);
  expect(result.stderr).toContain('MultiSourcePipelineRunner');
});
```

---

## Summary of files changed in Phase 2 for Phase 3 prep

| File | Change |
|---|---|
| `src/config/schema.ts` | Add `MergeFieldStrategySchema`, `MergeSchema`, `MultiSourceEntrySchema` (with `rename`); update `PipelineSchema` with optional `source`/`sources`/`merge`; add three `.refine()` validations |
| `src/config/types.ts` | Re-export `MergeConfig`, `MultiSourceEntry`, `isSingleSource`, `isMultiSource` |
| `src/runner.ts` | Add `isMultiSource` guard with clear error message |
| `src/merge/types.ts` | **New file.** `MergeSourceMeta`, `MergeResult`, `MergeStrategyPlugin` interfaces |
| `src/merge/index.ts` | **New file.** `MergeStrategyRegistry` |
| `src/index.ts` | Export new merge types and registry |
| Plugin loader | Recognise and register `MergeStrategyPlugin` exports |
| `tests/fixtures/style-co-products-merged.pipeline.yaml` | **New fixture.** Full multi-source example |
| `tests/unit/config/multi-source.test.ts` | **New test file.** 8 schema validation tests |
| `tests/unit/merge/registry.test.ts` | **New test file.** Registry tests |
| `tests/integration/cli-check.test.ts` | Extend with 3 multi-source CLI tests |

## What NOT to do in Phase 2

- Do not implement `MergeEngine`, `sql-builder.ts`, or `conflict-log.ts` —
  Phase 3 only.
- Do not implement the four built-in merge strategies (`coalesce` etc.) —
  Phase 3 only.
- Do not add `MultiSourcePipelineRunner` — Phase 3 only.
- Do not change the run state file format — Phase 3 only.
- Do not add `sourceId` filtering logic to `DQEngine.run()` — Phase 3 only.
- Do not make `source` required in `PipelineSchema` — it is now optional.
  Any code that assumed `config.source` is always present must use
  `isSingleSource(config)` before accessing it.

## Handover checklist to Phase 3

By the end of Phase 2, Phase 3 can assume:

- [ ] `ExtractResult.tableName` is `string`
- [ ] All source adapters accept `targetTable` parameter
- [ ] `DQEngine.run()` accepts `tableName` parameter
- [ ] `TransformEngine.run()` accepts `sourceTable`/`targetTable` parameters
- [ ] `PipelineRunner` has `protected` phase methods
- [ ] `StagingStore.renameColumns(tableName, renames)` exists and is tested
- [ ] `MergeSchema` and `MultiSourceEntrySchema` (including `rename` field) are in `schema.ts`
- [ ] `isSingleSource()` and `isMultiSource()` type guards exist
- [ ] `MergeStrategyPlugin` interface is in `src/merge/types.ts`
- [ ] `MergeStrategyRegistry` is in `src/merge/index.ts`
- [ ] Multi-source YAML validates cleanly via `sluice check`
- [ ] `sluice run` on a multi-source YAML gives a clear, actionable error
- [ ] `tests/fixtures/style-co-products-merged.pipeline.yaml` exists, parses cleanly, and includes `rename` maps
