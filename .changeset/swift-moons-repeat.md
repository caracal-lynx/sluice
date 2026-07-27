---
"@caracal-lynx/sluice": minor
---

Replace `exceljs` with `read-excel-file` in the xlsx source adapter (DAG-207).

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
