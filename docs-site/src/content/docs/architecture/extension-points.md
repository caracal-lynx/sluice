---
title: Extension Points
description: The plugin registry, discovery process, and the interfaces every Sluice extension point exposes.
---

This page is the architecture-level reference for Sluice's extension surface. If you want a tutorial on writing plugins, read [Plugin System](/sluice/guides/plugin-system/) first; this page is for plugin authors who want to know what the registry actually does and where the boundary between engine and plugin code sits.

## Module boundary

Plugins live in `src/plugins/`. The module exports four interfaces and two registries; **`src/plugins/` is imported by `runner`, `dq`, `transform`, and `merge`, but it does not import any of them**. That keeps the dependency graph acyclic and means you can add new plugin types without restructuring the engine.

```
plugins/
├── types.ts        ← RulePlugin, TransformPlugin, MergeStrategyPlugin, PluginPackage
├── registry.ts     ← RuleRegistry, TransformRegistry (custom plugin holders)
└── loader.ts       ← loadPlugins (file-based), loadNpmPlugins (sluice.config.yaml)
```

## The four extension interfaces

### `RulePlugin`

```typescript
export interface RulePlugin {
  readonly id: string;
  readonly description?: string;
  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null;
}
```

Returns `null` if the value passes; returns a `RuleViolation` if it fails. `severity` and an optional `message` come from `config`.

### `TransformPlugin`

```typescript
export interface TransformPlugin {
  readonly id: string;
  readonly description?: string;
  apply(value: unknown, row: Record<string, unknown>, config: CustomFieldMapping): unknown;
}
```

Custom transforms are referenced from `transform.fields[]` as `type: custom` with `customOp: <id>`. Sluice passes the source value, the whole `row` (in case the transform needs sibling fields), and the field mapping — which carries any per-field `options:` from the YAML.

Note the argument order: **`(value, row, config)`**. Like `RulePlugin`, `apply()` is contractually **synchronous and pure** — it must not perform I/O and must not mutate `row`. Return `null` to emit a null; throw `TransformError` for an unrecoverable value. The one plugin interface permitted to be async and do I/O is [`EnrichPlugin`](/sluice/reference/prep-and-enrich/#writing-an-enrich-provider).

### `MergeStrategyPlugin`

```typescript
export interface MergeStrategyPlugin {
  readonly id: string;
  readonly description?: string;
  merge(
    store: StagingStore,
    sources: MergeSourceMeta[], // priority-ordered (priority 1 first)
    config: MergeConfig,
  ): Promise<MergeResult>;
}
```

Strategies receive an open `StagingStore` and a priority-ordered list of source tables. The strategy is responsible for materialising `stg_merged` (and optionally `stg_merge_conflicts`) and returning a `MergeResult`. The four built-in strategies (`coalesce`, `priority-override`, `union`, `intersect`) are the canonical reference implementations — see [`src/merge/strategies/`](https://github.com/caracal-lynx/sluice/tree/master/src/merge/strategies).

### `SourceAdapter` and `TargetAdapter`

These are the heaviest extension points — they're what drives every Extract and Load. Their interfaces live in `src/adapters/source/types.ts` and `src/adapters/target/types.ts`:

```typescript
export interface SourceAdapter {
  readonly id: string;
  connect(config: SourceConfig): Promise<void>;
  extract(
    config: SourceConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
    targetTable?: string,
  ): Promise<ExtractResult>;
  disconnect(): Promise<void>;
}

export interface TargetAdapter {
  readonly id: string;
  connect(config: TargetConfig): Promise<void>;
  load(
    config: TargetConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
  ): Promise<LoadResult>;
  disconnect(): Promise<void>;
}
```

Custom adapters register themselves via a Tier 3 npm package's `register()` function. The built-in IFS / Business Central / BlueCherry adapters are not plugins — they are compiled into the core and self-register from `src/adapters/target/index.ts` — but they are the closest reference implementations to read.

## Registries

Two registries live in `src/plugins/registry.ts`:

- `RuleRegistry` — holds custom DQ rules (built-in rules live in `src/dq/rules/`).
- `TransformRegistry` — holds custom transforms (built-in transforms are baked into `src/transform/engine.ts`).

A separate registry lives in `src/merge/index.ts`:

- `MergeStrategyRegistry` — pre-loaded with `coalesce`, `priority-override`, `union`, `intersect`; custom strategies are added by Tier 2 file plugins or Tier 3 packages.

Adapters use their own registries:

- `SourceAdapterRegistry` (`src/adapters/source/registry.ts`) — pre-loaded with `csv`, `mssql`, `pg`, `xlsx`, `rest`, `odoo-csv`, `json`.
- `TargetAdapterRegistry` (`src/adapters/target/registry.ts`) — pre-loaded with `csv`, `ifs`, `bluecherry`, `pg`, `bc`.

Both adapter barrels self-register their built-ins on first import, so importing the barrel is enough to make them resolvable.

Each registry exposes `register(plugin)`, `get(id)`, `has(id)`, and `list()`. The adapter registries also expose `unregister(id)`, which is there for tests. Note the method is `register()`, not `add()` — and the two adapter registries **throw** on a duplicate id rather than overwriting.

## Discovery: the resolution order

`PipelineRunner.loadAllPlugins()` is called at the start of every run. It walks four sources in order:

1. **Built-ins** — registered eagerly when their barrel modules are imported.
2. **Composite rules (Tier 1)** — expanded by `ConfigLoader` from the file at `dq.rulesFile`.
3. **File plugins (Tier 2)** — discovered by globbing `plugins/*.{rule,transform,merge}.{ts,js}` next to the pipeline YAML, plus any directory passed via `--plugins`.
4. **npm package plugins (Tier 3)** — listed in `sluice.config.yaml` at the repo root; each package's exported `register()` function is called once.

Later registrations override earlier ones for the same id. Use distinctive ids (e.g. `ifsCustomerNo`, not `customerNo`) to avoid surprise overrides.

## File plugin loading on Windows

Tier 2 plugins are loaded with `import()` from absolute paths. Node 24's stricter ESM loader rejects raw `C:\…` paths, so the loader wraps them in `pathToFileURL()` first. This is invisible to plugin authors but is the reason Tier 2 works on Windows where it would otherwise silently fail.

## How `sluice plugins` introspects

The `sluice plugins` CLI command loads Tier 2 and Tier 3 plugins, then prints the ids held by the `RuleRegistry`, the `TransformRegistry`, and the `MergeStrategyRegistry` as a single structured log line:

```json
{
  "rules": ["ifsCustomerNo"],
  "transforms": ["normaliseUkPhone"],
  "mergeStrategies": ["coalesce", "priority-override", "union", "intersect", "mostRecent"],
  "msg": "sluice plugins: loaded"
}
```

It reports **ids only** — not descriptions, and not which tier each plugin came from. It also does not list the source or target adapter registries. So it answers "was my plugin loaded at all?", which is the common failure, but not "which of these two things registered `foo`?". For the latter, run with `--log-level debug` and read the per-file load lines.

## See also

- [Plugin System](/sluice/guides/plugin-system/) — how to write plugins
- [PLUGINS.md](https://github.com/caracal-lynx/sluice/blob/master/PLUGINS.md) — full author guide
- [How It Works](/sluice/architecture/how-it-works/) — runtime architecture
