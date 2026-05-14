---
"@caracal-lynx/sluice": minor
---

Add `stagingDb?: string` to `RunOverrides`. Library callers (notably `@caracal-lynx/sluice-mcp`'s `dry_run_pipeline` tool) can now force a specific DuckDB staging path — typically `':memory:'` — for a single invocation without rewriting the YAML on disk. CLI behaviour is unchanged: when the override is omitted, `run.stagingDb` continues to come from the loaded config.
