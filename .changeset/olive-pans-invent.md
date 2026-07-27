---
"@caracal-lynx/sluice": patch
---

Fix xlsx error cells staging as `#ERROR_#DIV/0!` instead of `#DIV/0!`.

`read-excel-file` prefixes Excel error codes with its own `#ERROR_` marker,
which leaked into staged data in 0.9.0. The xlsx source adapter now strips it,
restoring the value emitted before the reader swap (DAG-207).

Found by adding the fixture coverage that 0.9.0 shipped without. Rich text,
hyperlinks and formulas were verified to render identically to the previous
reader — rich text concatenates its runs, hyperlinks yield their visible text
rather than the target URL, formulas yield their cached result — and all four
are now pinned by a test so a future reader upgrade cannot change extracted
values silently.
