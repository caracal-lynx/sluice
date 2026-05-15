# @caracal-lynx/sluice

## 0.6.0

### Minor Changes

- [#118](https://github.com/caracal-lynx/sluice/pull/118) [`ccf1c3d`](https://github.com/caracal-lynx/sluice/commit/ccf1c3d30f393a3af4773af2b7b6ce0bcf304f90) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Export `BUILTIN_CLEANSE_OPS` from the package root — an immutable, ordered array of `{ id, description, argSpec? }` records describing every built-in cleanse op accepted by `applyCleanse` (`trim`, `uppercase`, `lowercase`, `titleCase`, `stripNonAlpha`, `stripNonNumeric`, `stripWhitespace`, `nullIfEmpty`, `normaliseQuotes`, `normaliseUnicode`, `padStart`, `padEnd`, `truncate`). Lets external tooling — `@caracal-lynx/sluice-mcp`'s `list_transform_ops` tool, doc generators, IDE autocomplete helpers — enumerate the supported ops without duplicating the list. The corresponding `BuiltinCleanseOpInfo` type is also exported.

## 0.5.0

### Minor Changes

- [#114](https://github.com/caracal-lynx/sluice/pull/114) [`1e4d3ce`](https://github.com/caracal-lynx/sluice/commit/1e4d3cef1cad029abee4a6a41bcc40ddc384b24f) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Add `stagingDb?: string` to `RunOverrides`. Library callers (notably `@caracal-lynx/sluice-mcp`'s `dry_run_pipeline` tool) can now force a specific DuckDB staging path — typically `':memory:'` — for a single invocation without rewriting the YAML on disk. CLI behaviour is unchanged: when the override is omitted, `run.stagingDb` continues to come from the loaded config.

### Patch Changes

- [#111](https://github.com/caracal-lynx/sluice/pull/111) [`cb6273f`](https://github.com/caracal-lynx/sluice/commit/cb6273fd258cf3403cbbe9a9e505c9e4717620d6) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - **Security**: replace `expr-eval@2.0.2` with `expr-eval-fork@^3.0.3` to remediate two HIGH severity vulnerabilities ([GHSA-rpw9-cf2g-5q7g](https://github.com/advisories/GHSA-rpw9-cf2g-5q7g) prototype pollution and the unrestricted function-evaluation advisory). The fork is a community-maintained drop-in replacement — same Parser API, same expression syntax — that ships the patches the original maintainer never released to npm.

  No user-visible behaviour change: pipeline YAML files using `type: expression` continue to work without modification.

- [#113](https://github.com/caracal-lynx/sluice/pull/113) [`c1bc6e4`](https://github.com/caracal-lynx/sluice/commit/c1bc6e4bdf78d97cd48c69f0eaabe34b50841027) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - **Security**: replace `xlsx@0.18.5` (SheetJS) with `exceljs@^4.4.0` to remediate two HIGH severity vulnerabilities — [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) (prototype pollution) and [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) (ReDoS). Both advisories have `fix: null` on npm because SheetJS publishes patches only via their CDN tarball, not to the public registry.

  The `xlsx` source adapter is rewritten on top of ExcelJS. The pipeline YAML `adapter: xlsx` identifier and all its options (`file`, `sheet`) remain unchanged — pipelines using the adapter continue to work without modification.

  Together with the earlier `expr-eval-fork` swap this run, `npm audit` now reports **zero vulnerabilities** on the public sluice repo.

## 0.4.0

### Minor Changes

- [#67](https://github.com/caracal-lynx/sluice/pull/67) [`b224131`](https://github.com/caracal-lynx/sluice/commit/b2241319ed43dbd25d23c20a7629561d3486be42) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - ✨ Add the `odoo-csv` source adapter for Odoo's product/customer/etc. CSV exports.

  Odoo's CSV exports have one structural quirk the plain `csv` adapter
  can't handle: products with multi-axis variants emit a "continuation
  row" for every variant axis beyond the first, leaving every column blank
  except the one carrying the `Key: value` cell (typically
  `Variant Values`).

  The new adapter merges continuation rows into their preceding parent and,
  when `pivot:` is declared, splits each `Key: value` cell on the first
  colon and routes the value into a new column named after the key.

  ```yaml
  source:
    adapter: odoo-csv
    file: ./sources/odoo-products.csv
    pivot:
      column: 'Variant Values'
      keys: [Size, 'Colours Pioneer', COLOUR_YARN]
      onUnknownKey: warn # warn (default) | error
      dropOriginal: true # default true — drop the pivot column from output
  ```

  Behaviour:
  - **Continuation merge** is unambiguous: a row where every column except
    `pivot.column` is blank is treated as an additional `Key: value`
    contribution to the preceding parent row.
  - **Output schema is stable**: declared `pivot.keys` are the only new
    columns. In `onUnknownKey: warn` mode, unknown keys are logged and
    dropped — they do not become output columns.
  - **Same-key collision** inside one logical row (e.g. parent and
    continuation both contribute `Size:`) warns and last-wins.
  - **Orphan continuation rows** (no preceding parent) abort the run with
    a clear `SourceError`.
  - Without `pivot:`, the adapter behaves like the plain `csv` adapter —
    the brand reserves namespace for future Odoo-specific quirks
    (M2M-comma-joined cells, locale-aware dates/currencies) without
    bloating other adapters.

  Backwards compatible. Existing pipelines are unaffected.

- [#66](https://github.com/caracal-lynx/sluice/pull/66) [`fc84d9b`](https://github.com/caracal-lynx/sluice/commit/fc84d9bddfccacae4c262014ba34259237e6470c) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - ✨ Add the `unmapped: true` field-mapping directive for iterative pipeline drafts.

  When a field mapping declares `unmapped: true`, the transform engine emits
  `transform.unmappedPlaceholder` (default `*** TBC ***`) for every row,
  regardless of `from`, `type`, `cleanse`, or `max`. The directive lets a
  draft pipeline run end-to-end before its source fields have been
  identified, so client-facing output can be reviewed iteratively as
  mappings are wired in.

  ```yaml
  transform:
    unmappedPlaceholder: '*** TBC ***' # optional override
    fields:
      - to: Division
        type: string
        unmapped: true # emits placeholder for every row
  ```

  The Zod refinement on `FieldMappingSchema` that requires `from` for
  source-reading types (`string`, `number`, `decimal`, `boolean`, `date`,
  `lookup`, `concat`) is relaxed when `unmapped: true`. Existing pipelines
  are unaffected — `unmapped` defaults to undefined.

## 0.3.0

### Minor Changes

- [#65](https://github.com/caracal-lynx/sluice/pull/65) [`90d50a7`](https://github.com/caracal-lynx/sluice/commit/90d50a75e08608a3d48b03b233fd02210a4ea88d) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - ✨ Add Phase 12 — Prep Phase (pre-enrich data fixup).

  A new optional `prep:` block on the pipeline YAML lets you mutate the staging
  table in place between Extract and Enrich, so external API lookups and DQ both
  see already-fixed data. Each rule applies a `cleanse:` pipe chain (with the
  new `padEnd:<len>:<char>` op), an `expression:`, or a `lookup:` to one column,
  with an optional `when:` row predicate. Multi-source pipelines support both
  pre-merge per-source firings (`sourceId:` scoped) and a post-merge firing
  against `stg_merged`.

  Companion CLI: `sluice run --no-prep` and `sluice validate --no-prep` skip the
  phase. New exit code 5 surfaces `PrepError`. Aggregated per-firing results are
  written to `{outputDir}/{name}-prep-summary.json` (override via
  `prep.summaryFile`).

  Backwards compatible: pipelines without a `prep:` block are unaffected; no
  existing schema, plugin interface, or test changes in a breaking way. See
  `docs/PHASE-12-prep-phase-spec.md` for the full specification.

### Patch Changes

- [#62](https://github.com/caracal-lynx/sluice/pull/62) [`5f4f04c`](https://github.com/caracal-lynx/sluice/commit/5f4f04c5e58f9dfb39321ce4b0be473ecbc27083) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - 📝 Correct company legal name in copyright headers and docs.

  The legal entity registered with Companies House (SC826823) is **Caracal Lynx Limited**, not "Caracal Lynx Ltd.". An earlier sweep had standardised the codebase on the abbreviated form. This change corrects every copyright header, sign-off, `author` field in `package.json`, and prose reference across the repo (112 occurrences in 90 files) back to the legal name. No runtime behaviour changes — comments and metadata only.

- [#64](https://github.com/caracal-lynx/sluice/pull/64) [`dc57822`](https://github.com/caracal-lynx/sluice/commit/dc57822beee048924f4726b9ea1450fc2872ec0c) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - 📧 Standardise commercial-enquiry contact on `sluice@caracallynx.com`.

  Replaces 12 references to `michael.scott@caracallynx.com` across docs, GitHub issue templates, `CONTRIBUTING.md`, and the `package.json` author field with the dedicated `sluice@caracallynx.com` mailbox. The README and doc-site had already moved to `sluice@…` (PR [#34](https://github.com/caracal-lynx/sluice/issues/34)); this cleans up the remaining files so every public-facing contact point routes through the same inbox. No code changes.

## 0.2.1

### Patch Changes

- [#52](https://github.com/caracal-lynx/sluice/pull/52) [`06f70dc`](https://github.com/caracal-lynx/sluice/commit/06f70dc2466330579ccd933c10ea22ffcf368848) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - 🐛 Fix `sluice --version` reporting a stale hardcoded `0.1.0` regardless of installed version.

  `src/cli.ts` previously called `program.version('0.1.0')` with a literal string that was set at first release and never updated. Every published version since (`0.1.1`, `0.1.2`, `0.1.3`, `0.2.0`) reported `0.1.0` when users ran `sluice --version`.

  Now reads the version dynamically from the installed package's `package.json` at runtime, mirroring the pattern already used by `@caracal-lynx/sluice-enrich`'s CLI. Future releases will self-report correctly without anyone needing to remember to update a literal.

## 0.2.0

### Minor Changes

- [#48](https://github.com/caracal-lynx/sluice/pull/48) [`d6d06a1`](https://github.com/caracal-lynx/sluice/commit/d6d06a134bd1466a2bb4df090b8bf6c4c3a54495) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Phase 4 prep — table-name plumbing for the enrich phase.

  The Phase 4a OSC scaffolding hardcoded `stg_raw` as the table the enrich runner
  operates on, but the multi-source pipeline runner invokes the enrich phase
  between `merge` (which produces `stg_merged`) and post-merge DQ. To make that
  work end-to-end without mutating `stg_merged` in place, the public surface now
  plumbs a `sourceTable` argument:
  - `EnrichPhaseFactory` gains a 6th parameter `sourceTable: string`. The
    open-source `PipelineRunner.runEnrich()` passes `'stg_raw'` for single-source
    pipelines; `MultiSourcePipelineRunner.runEnrich()` passes `'stg_merged'`.
  - The three Phase 4a `StagingStore` stubs (`selectDistinct`,
    `addColumnIfNotExists`, `batchUpdateColumns`) now take `table: string` as
    their first parameter. They still throw with the
    `install @caracal-lynx/sluice-enrich` message until the private package is
    installed and patches the prototype.
  - `Logger` (from pino) is now re-exported from the public barrel so downstream
    consumers can import the type via `@caracal-lynx/sluice` without taking a
    direct dependency on pino.
  - `EnrichError` is now re-exported alongside the other public error classes.
    It's already used internally by the CLI to map onto exit code 4, but
    downstream packages (notably `@caracal-lynx/sluice-enrich`) need to be able
    to throw an `instanceof EnrichError` for that mapping to fire — so it has to
    be reachable via the public path.

  The upcoming `@caracal-lynx/sluice-enrich@0.1.0` will require this version as
  its peer dependency lower bound.

## 0.1.3

### Patch Changes

- [#34](https://github.com/caracal-lynx/sluice/pull/34) [`3825f80`](https://github.com/caracal-lynx/sluice/commit/3825f80cf049496c54150285080d75bdefb28057) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Update the paid-services contact email in README.md from a personal address to the dedicated `sluice@caracallynx.com` mailbox so commercial enquiries land in a routable inbox.
