---
"@caracal-lynx/sluice": patch
---

**Security**: add npm `overrides` to force `tmp@>=0.2.6` transitively via `exceljs`, remediating [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) (Path Traversal via unsanitized prefix/postfix that enables directory escape). No runtime behaviour change; resolves the high-severity `npm audit` finding so the org-wide reusable CI's `--audit-level=high` gate passes.

Drop the override once `exceljs` ships a release that depends on `tmp@>=0.2.6` directly.
