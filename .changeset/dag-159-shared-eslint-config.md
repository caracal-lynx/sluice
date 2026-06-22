---
"@caracal-lynx/sluice": patch
---

Consume the shared `@caracal-lynx/eslint-config` package via `extends` (DAG-159), replacing Sluice's inlined DAG-158 pilot config. Keeps only the Sluice-specific deltas (the `docs-site` ignore and the split-tsconfig project wiring) and points the Prettier config at the package subpath. Lint/format configuration only — no public API or runtime changes.
