---
'@caracal-lynx/sluice': minor
---

✨ Add Phase 12 — Prep Phase (pre-enrich data fixup).

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
