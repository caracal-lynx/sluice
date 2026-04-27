# Sluice — Phase 3 Preparation Work for Phase 1
# Implementation instructions for Claude Code
# Author: Michael Scott, Caracal Lynx Limited
# Date: 2026-04-17

---

## Purpose

These are targeted, backwards-compatible changes that must be made **during
Phase 1** to lay the groundwork for Phase 3's multi-source merge feature.
None of them alter observable behaviour for single-source pipelines.

Implement these changes alongside the normal Phase 1 build. Do not defer
them to a later phase — they affect core interfaces that would be painful to
retrofit once adapters and tests are built against the original signatures.

Read `docs/phase3-multi-source-merge.md` for full context on why each
change is needed. This document contains only implementation instructions.

---

## Change 1 — `src/adapters/source/types.ts`: parameterise `tableName`

### Why

The current spec hardcodes `tableName: 'stg_raw'` in `ExtractResult`.
In Phase 3, each source extracts into its own staging table
(`stg_raw_sql_server`, `stg_raw_custom`, etc.), so the caller must be able
to specify the target table name. Making the type `string` now costs
nothing and avoids a breaking change across all five adapters later.

### What to change

**`ExtractResult`** — change the literal type to `string`:

```typescript
// BEFORE
export interface ExtractResult {
  rowsExtracted: number;
  tableName:     'stg_raw';
  columns:       ColumnMeta[];
}

// AFTER
export interface ExtractResult {
  rowsExtracted: number;
  tableName:     string;   // caller-supplied; 'stg_raw' in single-source mode
  columns:       ColumnMeta[];
}
```

**`SourceAdapter.extract()`** — add an optional `targetTable` parameter:

```typescript
// BEFORE
export interface SourceAdapter {
  readonly id: string;
  connect(config: SourceConfig): Promise<void>;
  extract(
    config:     SourceConfig,
    store:      StagingStore,
    runConfig:  RunConfig,
    onProgress: (rows: number) => void
  ): Promise<ExtractResult>;
  disconnect(): Promise<void>;
}

// AFTER
export interface SourceAdapter {
  readonly id: string;
  connect(config: SourceConfig): Promise<void>;
  extract(
    config:      SourceConfig,
    store:       StagingStore,
    runConfig:   RunConfig,
    onProgress:  (rows: number) => void,
    targetTable?: string               // defaults to 'stg_raw' inside each adapter
  ): Promise<ExtractResult>;
  disconnect(): Promise<void>;
}
```

### What to change in each adapter

Apply the same pattern to all five source adapters
(`mssql.ts`, `pg.ts`, `csv.ts`, `xlsx.ts`, `rest.ts`):

```typescript
// Pattern to follow in every adapter implementation:
async extract(
  config:      SourceConfig,
  store:       StagingStore,
  runConfig:   RunConfig,
  onProgress:  (rows: number) => void,
  targetTable  = 'stg_raw'             // default here, not in the interface
): Promise<ExtractResult> {
  // Use targetTable wherever 'stg_raw' would previously have been hardcoded.
  // e.g. store.createTable(targetTable, columns)
  //      store.insertBatch(targetTable, batch)
  return { rowsExtracted, tableName: targetTable, columns };
}
```

### What to change in `PipelineRunner`

In single-source mode, pass `'stg_raw'` explicitly when calling `extract()`.
Do not rely on the default — being explicit makes grep-ability and Phase 3
extension obvious:

```typescript
const result = await sourceAdapter.extract(
  config.source,
  store,
  config.run,
  (rows) => logger.debug({ rows }, 'extracting'),
  'stg_raw'   // ← explicit
);
```

### Tests to update

- Any unit test that asserts `result.tableName === 'stg_raw'` still passes
  (the default behaviour is unchanged).
- Add a test in each adapter's test file asserting that passing a custom
  `targetTable` value causes the adapter to create and populate a table with
  that name in the staging store.

---

## Change 2 — `src/config/schema.ts`: add `sourceId` to `DqRuleSchema`

### Why

In Phase 3, DQ rules can be scoped to a specific source (run against
`stg_raw_sql_server`) or post-merge (run against `stg_merged`). The
`sourceId` field is how the user declares this in YAML. Adding it now means
no Zod schema breaking change is needed in Phase 3. In Phase 1, the field
is parsed and stored but simply ignored by the DQ engine.

### What to change

```typescript
// BEFORE
const DqRuleSchema = z.object({
  field:  z.string(),
  checks: z.array(CheckSchema).min(1),
});

// AFTER
const DqRuleSchema = z.object({
  field:    z.string(),
  sourceId: z.string().optional(),   // Phase 3: scopes rule to a named source
  checks:   z.array(CheckSchema).min(1),
});
```

No other changes needed in Phase 1. The `DQEngine` does not need to read
`sourceId` yet — it processes every rule it is given, and in single-source
mode no rule will ever have `sourceId` set.

### Tests to update

- Add a config loader test: a DQ rule with `sourceId: sql-server` parses
  cleanly (does not throw a ZodError).
- Confirm existing DQ tests still pass — `sourceId` being optional means
  all existing fixtures remain valid.

---

## Change 3 — `src/dq/engine.ts`: accept `tableName` parameter

### Why

The DQ engine currently queries whichever table it was built against. In
Phase 3 it will be called against multiple tables: once per source (e.g.
`stg_raw_sql_server`) and once post-merge against `stg_merged`. Adding the
parameter now means the engine is already flexible when Phase 3 needs it.

### What to change

Wherever `DQEngine` (or its `run` method) references the staging table name,
replace the hardcoded string with a parameter that defaults to `'stg_raw'`:

```typescript
// BEFORE — however the engine currently queries the store
class DQEngine {
  async run(
    config: Pipeline,
    store:  StagingStore
  ): Promise<DQSummary> {
    // internally queries 'stg_raw'
  }
}

// AFTER
class DQEngine {
  async run(
    config:    Pipeline,
    store:     StagingStore,
    tableName  = 'stg_raw'   // which staging table to check
  ): Promise<DQSummary> {
    // use tableName wherever 'stg_raw' previously appeared
  }
}
```

Update `PipelineRunner` to pass `'stg_raw'` explicitly when calling
`dqEngine.run()` — same reasoning as the adapter change above.

### Tests to update

No new test cases required in Phase 1. Existing DQ engine tests continue
to work because the default is unchanged. Add a note in the test file that
a future Phase 3 test will exercise calling `run()` with `'stg_merged'`.

---

## Change 4 — `src/transform/engine.ts`: accept source and target table names

### Why

The transform engine reads from `stg_raw` and writes to `stg_transformed`.
In Phase 3, it reads from `stg_merged` and writes to `stg_transformed`.
Parameterising both table names now means the engine works for both modes
without modification.

### What to change

```typescript
// BEFORE
class TransformEngine {
  async run(
    config: Pipeline,
    store:  StagingStore
  ): Promise<TransformResult> {
    // reads from 'stg_raw', writes to 'stg_transformed'
  }
}

// AFTER
class TransformEngine {
  async run(
    config:      Pipeline,
    store:       StagingStore,
    sourceTable  = 'stg_raw',          // where to read rows from
    targetTable  = 'stg_transformed'   // where to write transformed rows
  ): Promise<TransformResult> {
    // use sourceTable and targetTable throughout; no hardcoded table names
  }
}
```

Update `PipelineRunner` to pass both table names explicitly.

### Tests to update

Existing transform tests continue to pass. The defaults are unchanged.

---

## Change 5 — `src/runner.ts`: decompose into protected phase methods

### Why

In Phase 3 a `MultiSourcePipelineRunner` will subclass `PipelineRunner` to
orchestrate N extracts, the merge phase, and then the shared DQ → transform
→ load sequence. If the runner is a single monolithic `run()` method,
Phase 3 cannot reuse any of it without duplication. Decomposing into
`protected` phase methods now makes the multi-source runner a clean
subclass.

### What to change

Restructure `PipelineRunner` so the top-level `run()` method delegates to
discrete `protected` methods. The **public API is unchanged** — `run()` is
still the only public method, and its behaviour for single-source pipelines
is identical.

```typescript
export class PipelineRunner {

  // ── Public API (unchanged) ───────────────────────────────────────────

  async run(yamlPath: string): Promise<RunResult> {
    const config = await ConfigLoader.load(yamlPath);
    const store  = new StagingStore(this.resolveStagingDb(config));
    try {
      await store.open();
      const extractResult  = await this.runExtract(config, store);
      const dqSummary      = await this.runDQ(config, store, extractResult.tableName);
      if (config.dq.stopOnCritical && dqSummary.violations.critical > 0) {
        throw new PipelineDQError(dqSummary.violations.critical, dqSummary.reportPath);
      }
      if (config.run.dryRun || config.run.mode === 'validate-only') {
        return this.buildRunResult(config, extractResult, dqSummary, null);
      }
      const transformResult = await this.runTransform(config, store,
                                extractResult.tableName, 'stg_transformed');
      const loadResult      = await this.runLoad(config, store);
      await this.writeStateFile(config, extractResult, dqSummary, loadResult);
      return this.buildRunResult(config, extractResult, dqSummary, loadResult);
    } finally {
      await store.close();
    }
  }

  // ── Protected phase methods (overrideable by MultiSourcePipelineRunner) ─

  protected async runExtract(
    config:    Pipeline,
    store:     StagingStore,
    tableName  = 'stg_raw'
  ): Promise<ExtractResult> {
    const adapter = SourceAdapterRegistry.get(config.source.adapter);
    await adapter.connect(config.source);
    try {
      return await adapter.extract(
        config.source, store, config.run,
        (rows) => logger.debug({ rows }, 'extracting'),
        tableName
      );
    } finally {
      await adapter.disconnect();
    }
  }

  protected async runDQ(
    config:    Pipeline,
    store:     StagingStore,
    tableName  = 'stg_raw',
    sourceId?: string       // Phase 3: filters rules by sourceId; unused here
  ): Promise<DQSummary> {
    return this.dqEngine.run(config, store, tableName);
  }

  protected async runTransform(
    config:      Pipeline,
    store:       StagingStore,
    sourceTable  = 'stg_raw',
    targetTable  = 'stg_transformed'
  ): Promise<TransformResult> {
    return this.transformEngine.run(config, store, sourceTable, targetTable);
  }

  protected async runLoad(
    config: Pipeline,
    store:  StagingStore
  ): Promise<LoadResult> {
    const adapter = TargetAdapterRegistry.get(config.target.adapter);
    await adapter.connect(config.target);
    try {
      return await adapter.load(config.target, store, config.run,
        (rows) => logger.debug({ rows }, 'loading'));
    } finally {
      await adapter.disconnect();
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private resolveStagingDb(config: Pipeline): string {
    if (config.run.stagingDb) return config.run.stagingDb;
    if (config.run.dryRun)    return ':memory:';
    return path.join(config.run.outputDir, `${config.pipeline.name}.duckdb`);
  }

  private buildRunResult(/* ... */): RunResult { /* ... */ }

  protected async writeStateFile(/* ... */): Promise<void> { /* ... */ }
}
```

**Important:** `writeStateFile` must be `protected` because `MultiSourcePipelineRunner`
will override it to write the per-source `sources` block in the state JSON.

### Tests to update

- All existing `PipelineRunner` integration tests continue to pass — the
  public `run()` behaviour is unchanged.
- Add unit tests for each protected method in isolation (these are now
  independently testable without running a full pipeline).
- Use `vi.spyOn` to verify that `run()` calls the phase methods in the
  correct order.

---

## Change 6 — `src/staging/store.ts`: add `renameColumns()`

### Why

In Phase 3, immediately after a source is extracted into `stg_raw_{sourceId}`,
any `rename` map declared on that source entry is applied in-place before DQ
rules run and before the merge phase. This requires a dedicated method on
`StagingStore` that rewrites the staging table with the renamed columns.
Adding it in Phase 1 alongside the rest of `StagingStore` is far cleaner than
retrofitting it later.

### What to add

Add `renameColumns()` to the `StagingStore` class:

```typescript
/**
 * Renames columns in an existing staging table.
 * Only the listed columns are affected; all others pass through unchanged.
 * If a key in `renames` does not exist in the table, logs a warning and
 * continues — does not throw.
 *
 * Implemented as CREATE OR REPLACE TABLE ... AS SELECT to avoid DuckDB
 * column-rename limitations.
 */
async renameColumns(
  tableName: string,
  renames: Record<string, string>   // { oldName: newName }
): Promise<void> {
  if (Object.keys(renames).length === 0) return;

  const existingColumns = await this.columnNames(tableName);
  const unknownKeys = Object.keys(renames).filter(k => !existingColumns.includes(k));
  if (unknownKeys.length > 0) {
    logger.warn({ tableName, unknownKeys }, 'rename map contains columns not found in table');
  }

  // Build SELECT list: renamed columns as aliases, everything else as-is
  const selectList = existingColumns.map(col => {
    const newName = renames[col];
    // Quote both sides to handle spaces and reserved words
    return newName
      ? `"${col}" AS "${newName}"`
      : `"${col}"`;
  }).join(', ');

  await this.query(
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT ${selectList} FROM "${tableName}"`
  );
}
```

### Tests to add

```typescript
// tests/unit/staging/store.test.ts — add to existing test file

describe('StagingStore.renameColumns()', () => {

  it('renames the specified columns', async () => {
    await store.createTable('test_rename', [
      { name: 'old_name', duckDbType: 'VARCHAR' },
      { name: 'keep_me',  duckDbType: 'BIGINT' },
    ]);
    await store.insertBatch('test_rename', [{ old_name: 'hello', keep_me: 1 }]);
    await store.renameColumns('test_rename', { old_name: 'new_name' });

    const cols = await store.columnNames('test_rename');
    expect(cols).toContain('new_name');
    expect(cols).not.toContain('old_name');
    expect(cols).toContain('keep_me');

    const rows = await store.query<{ new_name: string }>('SELECT new_name FROM test_rename');
    expect(rows[0].new_name).toBe('hello');
  });

  it('handles column names with spaces', async () => {
    await store.createTable('test_spaces', [
      { name: 'Style Number', duckDbType: 'VARCHAR' },
    ]);
    await store.renameColumns('test_spaces', { 'Style Number': 'STYLE_NO' });
    const cols = await store.columnNames('test_spaces');
    expect(cols).toContain('STYLE_NO');
    expect(cols).not.toContain('Style Number');
  });

  it('logs a warning and continues if a rename key is not in the table', async () => {
    await store.createTable('test_missing', [
      { name: 'STYLE_NO', duckDbType: 'VARCHAR' },
    ]);
    // Should not throw — just warn
    await expect(
      store.renameColumns('test_missing', { nonexistent: 'STYLE_NO' })
    ).resolves.not.toThrow();
  });

  it('is a no-op when renames is empty', async () => {
    await store.createTable('test_noop', [{ name: 'col', duckDbType: 'VARCHAR' }]);
    await expect(store.renameColumns('test_noop', {})).resolves.not.toThrow();
  });
});
```

---

## Change 7 — `src/utils/errors.ts`: no changes required

The existing error types cover Phase 3 needs. No changes needed in Phase 1.
A `MergeError extends PipelineError` may be added in Phase 3.

---

## Summary of files changed in Phase 1 for Phase 3 prep

| File | Change |
|---|---|
| `src/adapters/source/types.ts` | `tableName: string`; add `targetTable?` param to `extract()` |
| `src/adapters/source/mssql.ts` | Accept and use `targetTable` param |
| `src/adapters/source/pg.ts` | Accept and use `targetTable` param |
| `src/adapters/source/csv.ts` | Accept and use `targetTable` param |
| `src/adapters/source/xlsx.ts` | Accept and use `targetTable` param |
| `src/adapters/source/rest.ts` | Accept and use `targetTable` param |
| `src/config/schema.ts` | Add `sourceId?: string` to `DqRuleSchema` |
| `src/dq/engine.ts` | Add `tableName = 'stg_raw'` parameter to `run()` |
| `src/transform/engine.ts` | Add `sourceTable` and `targetTable` parameters to `run()` |
| `src/runner.ts` | Decompose into `protected` phase methods |
| `src/staging/store.ts` | Add `renameColumns(tableName, renames)` method |

## What NOT to do in Phase 1

- Do not add `MergeSchema`, `MultiSourceEntrySchema`, or `sources` to `PipelineSchema` —
  that belongs in Phase 2.
- Do not add a `MergeStrategyPlugin` interface — that belongs in Phase 2.
- Do not add any `src/merge/` directory or files — Phase 3 only.
- Do not add `MultiSourcePipelineRunner` — Phase 3 only.
- Do not change the state file format — Phase 3 only.
- Do not add `sourceId` filtering logic to `DQEngine.run()` — just accept
  the parameter and ignore it. Phase 3 implements the filtering.
- Do not call `renameColumns()` anywhere in Phase 1 code — it is built now
  but only invoked by Phase 3's `MultiSourcePipelineRunner`.
