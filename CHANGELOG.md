# @caracal-lynx/sluice

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
