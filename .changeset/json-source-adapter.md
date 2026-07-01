---
"@caracal-lynx/sluice": minor
---

Add a `json` file source adapter. Reads a local JSON file into staging, with an optional `recordPath` dot-path to the records array (root array when omitted); nested objects are flattened with `__` (logic shared with the `rest` adapter). Includes a `examples/legitify-findings/` worked example that ingests a Legitify posture scan into a normalised findings table (DAG-95).
