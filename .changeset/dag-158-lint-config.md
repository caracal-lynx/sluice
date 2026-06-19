---
"@caracal-lynx/sluice": patch
---

Adopt the standards-compliant ESLint + Prettier config (DAG-158 pilot). Resolves all `[LINT-01]` findings: the two fire-and-forget promises in the mssql source adapter are now explicitly `void`-ed, value stringification at data boundaries is hardened (objects render as JSON rather than `[object Object]`), and `tsconfig.test.json` is fixed so tests are actually type-checked. No public API changes.
