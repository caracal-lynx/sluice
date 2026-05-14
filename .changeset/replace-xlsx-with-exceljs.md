---
"@caracal-lynx/sluice": patch
---

**Security**: replace `xlsx@0.18.5` (SheetJS) with `exceljs@^4.4.0` to remediate two HIGH severity vulnerabilities — [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) (prototype pollution) and [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) (ReDoS). Both advisories have `fix: null` on npm because SheetJS publishes patches only via their CDN tarball, not to the public registry.

The `xlsx` source adapter is rewritten on top of ExcelJS. The pipeline YAML `adapter: xlsx` identifier and all its options (`file`, `sheet`) remain unchanged — pipelines using the adapter continue to work without modification.

Together with the earlier `expr-eval-fork` swap this run, `npm audit` now reports **zero vulnerabilities** on the public sluice repo.
