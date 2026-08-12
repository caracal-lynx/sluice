# @caracal-lynx/sluice

## 0.9.4

### Patch Changes

- [#59](https://github.com/caracal-lynx/data-gubbins/pull/59) [`d17fb07`](https://github.com/caracal-lynx/data-gubbins/commit/d17fb07f117fad34d6e17a1aeb858354042c5edb) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Converge `js-yaml` on v5 across the workspace, removing the deliberate v4/v5 split (DAG-222).

  `sluice` moves from `js-yaml@^4.2.0` to `^5.2.3`, matching `sluice-mcp`, which has run v5 all along.
  Both floors are set to `5.2.3` rather than `5.2.1` on purpose: 5.2.2 carries GHSA "Quadratic CPU
  consumption in `!!omap`" (high), so the declared range must exclude it.
  No source change was needed — every call site in both packages already uses named imports
  (`{ load }`, `{ dump }`), and v5 only drops the default export. The public API is unchanged.

  `@types/js-yaml` is dropped from both packages: js-yaml v5 ships its own type declarations, so the
  `@types/js-yaml@^4.0.9` devDependency was redundant in `sluice` and wrong-major in `sluice-mcp`.

  The v4 requirement has not disappeared, it has moved to where it is actually consumed. `docs-site`
  now declares `js-yaml@^4.3.1` of its own, because astro's prerender bundle needs a default export.
  4.3.1 is the patched release on the v4 line for the same advisory.

- [#67](https://github.com/caracal-lynx/data-gubbins/pull/67) [`944bd65`](https://github.com/caracal-lynx/data-gubbins/commit/944bd654bd7f7f7e92e504a77827947da9a91aa5) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Narrow the `read-excel-file` dependency range from `^9.3.4` to `>=9.3.4 <9.3.5` (DAG-261).

  From 9.3.5 the reader stops surfacing Excel error cells: a cell containing `#DIV/0!` used to arrive
  as `#ERROR_#DIV/0!` and now returns an empty string, so a failed formula stages as blank and becomes
  indistinguishable from a genuinely empty cell.

  The range is consumer-visible, and `^9.3.4` asserted that any 9.x at or above 9.3.4 is acceptable —
  which is not true. Consumers resolving the caret would silently pick up the data-loss behaviour.

  The Renovate hold added alongside this stops Renovate _proposing_ a newer version; it does not
  constrain resolution. Lock file maintenance regenerates from the declared range, so the manifest is
  what actually binds.

## 0.9.3

### Patch Changes

- [#9](https://github.com/caracal-lynx/data-gubbins/pull/9) [`e41e82b`](https://github.com/caracal-lynx/data-gubbins/commit/e41e82b09ecc3846f238fa544b9d3303cefb05cb) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Canary release validating a mixed public/restricted publish. No functional change.

## 0.9.2

### Patch Changes

- [#4](https://github.com/caracal-lynx/data-gubbins/pull/4) [`e953593`](https://github.com/caracal-lynx/data-gubbins/commit/e9535931cf36eb0cdf63573f559d5460cad3fa11) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Stop emitting npm provenance attestations.

  sluice now publishes from the private `caracal-lynx/data-gubbins` monorepo rather than the public
  `caracal-lynx/sluice` repo. npm requires the `repository` field to be public **and** to match the
  repo publishing with provenance, and no value satisfies both: the public mirror does not match the
  publisher, and the publisher is private. Pointing `repository` at the monorepo would also write a
  private repo's name and commit SHAs into the public Sigstore transparency log.

  `repository` continues to point at the public mirror, which is where the source is actually readable.

## 0.9.1

### Patch Changes

- [#279](https://github.com/caracal-lynx/sluice/pull/279) [`3379d93`](https://github.com/caracal-lynx/sluice/commit/3379d937912ea1410cdb9bf1b50221b0eb5e82c1) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Fix xlsx error cells staging as `#ERROR_#DIV/0!` instead of `#DIV/0!`.

  `read-excel-file` prefixes Excel error codes with its own `#ERROR_` marker,
  which leaked into staged data in 0.9.0. The xlsx source adapter now strips it,
  restoring the value emitted before the reader swap (DAG-207).

  Found by adding the fixture coverage that 0.9.0 shipped without. Rich text,
  hyperlinks and formulas were verified to render identically to the previous
  reader — rich text concatenates its runs, hyperlinks yield their visible text
  rather than the target URL, formulas yield their cached result — and all four
  are now pinned by a test so a future reader upgrade cannot change extracted
  values silently.

## 0.9.0

### Minor Changes

- [#277](https://github.com/caracal-lynx/sluice/pull/277) [`7a260ef`](https://github.com/caracal-lynx/sluice/commit/7a260efc221efb63da07d6e467fa36bc7f6131bc) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Replace `exceljs` with `read-excel-file` in the xlsx source adapter (DAG-207).

  `exceljs` had been stale since 2023 and its `archiver`/`unzipper`/`glob` chain
  produced three transitive security advisories, each previously absorbed as a
  hand-managed pnpm override. Sluice reads Excel only, so a read-only reader
  covers the whole surface.

  `pnpm audit` now reports zero advisories — the full audit, not just `--prod` —
  and the `tmp`, `uuid`, and `brace-expansion` overrides are all deleted along
  with the deprecated dependency chain.

  Behaviour for plain values, numbers, dates, and formulas is unchanged and
  verified. Rich text, hyperlinks, and error cells are now flattened by the reader
  rather than handled by explicit branches in the adapter, so exotic cells may
  render slightly differently; they still resolve to their visible text. Writing
  Excel is no longer possible, which is deliberate — see
  `docs/adr/0001-replace-exceljs-with-read-excel-file.md`.

## 0.8.2

### Patch Changes

- [#252](https://github.com/caracal-lynx/sluice/pull/252) [`559ce80`](https://github.com/caracal-lynx/sluice/commit/559ce801c4db8212618e842a258085ac80d4328b) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Revert js-yaml to v4. v5 is ESM-only and drops the default export, which breaks a transitive default-import in the docs-site astro/starlight prerender path. Pinned to `<5` in Renovate until the docs toolchain supports v5.

## 0.8.1

### Patch Changes

- [#244](https://github.com/caracal-lynx/sluice/pull/244) [`d0e4330`](https://github.com/caracal-lynx/sluice/commit/d0e4330c62e7c3582868549c6612eedf408ee1fa) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Update runtime dependencies: mssql 12.7.0, js-yaml 4.3.0, sharp 0.35.3, csv-parse 7.0.1, csv-stringify 6.8.1, and Node.js 24.18.0.

## 0.8.0

### Minor Changes

- [#231](https://github.com/caracal-lynx/sluice/pull/231) [`750d6f1`](https://github.com/caracal-lynx/sluice/commit/750d6f1c6814fd65d42e34a5498a9be858a380f3) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Add a `json` file source adapter. Reads a local JSON file into staging, with an optional `recordPath` dot-path to the records array (root array when omitted); nested objects are flattened with `__` (logic shared with the `rest` adapter). Includes a `examples/legitify-findings/` worked example that ingests a Legitify posture scan into a normalised findings table (DAG-95).

## 0.7.3

### Patch Changes

- [#227](https://github.com/caracal-lynx/sluice/pull/227) [`e41efd2`](https://github.com/caracal-lynx/sluice/commit/e41efd21e379dd263d0930c0e0dd26f899c3da92) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Enable the full `[C-01]` TypeScript strict baseline in `tsconfig.json`
  (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`,
  `useUnknownInCatchVariables`, `noImplicitOverride`, and the rest) and fix the
  resulting null-safety findings in the merge engine, the xlsx/bc adapters, and
  the dq/prep/transform/staging modules. All fixes are behaviour-preserving
  (real narrowing via destructuring/iterators — no `as`/`!`/`@ts-expect-error`).
  (DAG-10)

## 0.7.2

### Patch Changes

- [#216](https://github.com/caracal-lynx/sluice/pull/216) [`0f3ad5d`](https://github.com/caracal-lynx/sluice/commit/0f3ad5db70d797b601adea38e8ebc820478aeb00) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Consume the shared `@caracal-lynx/eslint-config` package via `extends` (DAG-159), replacing Sluice's inlined DAG-158 pilot config. Keeps only the Sluice-specific deltas (the `docs-site` ignore and the split-tsconfig project wiring) and points the Prettier config at the package subpath. Lint/format configuration only — no public API or runtime changes.

## 0.7.1

### Patch Changes

- [#207](https://github.com/caracal-lynx/sluice/pull/207) [`c5e3e09`](https://github.com/caracal-lynx/sluice/commit/c5e3e0995119f22b4ff5200f388ebc4b0f267509) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Adopt the standards-compliant ESLint + Prettier config (DAG-158 pilot). Resolves all `[LINT-01]` findings: the two fire-and-forget promises in the mssql source adapter are now explicitly `void`-ed, value stringification at data boundaries is hardened (objects render as JSON rather than `[object Object]`), and `tsconfig.test.json` is fixed so tests are actually type-checked. No public API changes.

## 0.7.0

### Minor Changes

- [#199](https://github.com/caracal-lynx/sluice/pull/199) [`e003640`](https://github.com/caracal-lynx/sluice/commit/e0036400c5ddad77966b352350df076f98a9aafd) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Reject unknown top-level keys in `PipelineSchema`

  The root pipeline object is now `.strict()`: any unrecognised top-level key (e.g. a
  misspelled or unsupported section) is rejected with a clear Zod path instead of being
  silently stripped. Previously a key such as `customChecks:` parsed with `valid: true`
  and then vanished at runtime, masking authoring mistakes.

  **Breaking:** pipelines that relied on extra top-level keys being ignored will now fail
  validation. Move any such keys under a supported section or remove them. Nested objects
  (`dq`, `transform`, `source`, `target`, …) are unaffected — only the top-level object is
  strict.

## 0.6.3

### Patch Changes

- [#171](https://github.com/caracal-lynx/sluice/pull/171) [`e248b95`](https://github.com/caracal-lynx/sluice/commit/e248b953a244f9b95ed8d57f394e4e1a1a006076) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Fix a race in the mssql source adapter where a streamed `INSERT` could run before its `CREATE TABLE` resolved, producing a spurious DuckDB "Table does not exist" error on small/fast result sets. The adapter now awaits table creation before every batch insert.

## 0.6.2

### Patch Changes

- [#156](https://github.com/caracal-lynx/sluice/pull/156) [`61d5970`](https://github.com/caracal-lynx/sluice/commit/61d5970195305454f35c79854d098d19b9cbd9b0) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - 🐛 DQ: clearer `pattern` rule error when `value:` is missing.

  The `pattern` rule's missing-value error now names the `value:` key explicitly
  and shows a regex example, so pipeline authors who hit it know which YAML key
  to set and roughly what shape it should take.

  Before: `pattern rule on field "X" requires a string value (the regex)`
  After: `pattern rule on field "X" requires a string \`value:\` key holding the regex (e.g. value: "^[A-Z0-9]+$")`

## 0.6.1

### Patch Changes

- [#151](https://github.com/caracal-lynx/sluice/pull/151) [`592cbab`](https://github.com/caracal-lynx/sluice/commit/592cbabad15497927872f168bd4818c6f94ab07f) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - **Security**: add npm `overrides` to force `tmp@>=0.2.6` transitively via `exceljs`, remediating [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) (Path Traversal via unsanitized prefix/postfix that enables directory escape). No runtime behaviour change; resolves the high-severity `npm audit` finding so the org-wide reusable CI's `--audit-level=high` gate passes.

  Drop the override once `exceljs` ships a release that depends on `tmp@>=0.2.6` directly.

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
      column: "Variant Values"
      keys: [Size, "Colours Pioneer", COLOUR_YARN]
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
    unmappedPlaceholder: "*** TBC ***" # optional override
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
