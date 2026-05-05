---
title: CI/CD Integration
description: Run Sluice in GitHub Actions — validate on PR, run on merge, exit codes, and how to handle secrets.
---

Sluice is built to run in CI. The CLI emits structured pino logs to stderr, the progress bar to stdout, and uses exit codes that map cleanly to "stop the merge" vs "let it through". This page covers the GitHub Actions pattern; other CI systems work the same way once you understand the exit codes.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — pipeline completed cleanly. |
| `1` | Pipeline error (adapter failure, DuckDB error, expression error, …). |
| `2` | DQ critical violations — at least one row failed a `critical` rule and `stopOnCritical: true`. |
| `3` | Config error — YAML parse failed or Zod validation failed. |
| `4` | Enrich error — Phase 4a private-add-on path. |

Most CI rules want **`exit 0` only**. A `2` or `3` should fail the job; a `1` indicates an infrastructure problem.

## The two-job pattern

For non-trivial migrations, run two jobs:

1. **On PR** — `sluice validate` against test fixtures. Catches schema, DQ, and transform errors without ever touching the source DB or target ERP.
2. **On merge** — `sluice run` against the real source and target.

```yaml
# .github/workflows/sluice.yml
name: Sluice

on:
  pull_request:
  push:
    branches: [master]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - name: Validate every pipeline against fixtures
        run: |
          for pipeline in pipelines/*.pipeline.yaml; do
            npx sluice check  "$pipeline"
            npx sluice validate "$pipeline" --dry-run
          done
      - name: Upload DQ summaries
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: dq-summaries
          path: output/*-dq-summary.json

  run:
    if: github.ref == 'refs/heads/master'
    needs: validate
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: npm }
      - run: npm ci
      - name: Run pipelines against real source/target
        env:
          SOURCE_MSSQL: ${{ secrets.SOURCE_MSSQL }}
          TARGET_PG:    ${{ secrets.TARGET_PG }}
          API_TOKEN:    ${{ secrets.API_TOKEN }}
        run: |
          for pipeline in pipelines/*.pipeline.yaml; do
            npx sluice run "$pipeline"
          done
      - name: Upload run artefacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: run-artefacts
          path: |
            output/*-rejected.csv
            output/*-dq-summary.json
            output/*-state.json
```

## Handling secrets

Connection strings and API tokens go through `${ENV_VAR}` references in the YAML and GitHub Actions secrets in the workflow:

```yaml
# pipeline.yaml
source:
  adapter: mssql
  connection: ${SOURCE_MSSQL}    # resolved from process.env at runtime
```

```yaml
# .github/workflows/sluice.yml
- name: Run
  env:
    SOURCE_MSSQL: ${{ secrets.SOURCE_MSSQL }}
  run: npx sluice run pipeline.yaml
```

Sluice's [`ConfigLoader`](https://github.com/caracal-lynx/sluice/blob/master/src/config/loader.ts) interpolates the tokens **before** Zod validation runs, so the schema only ever sees plain strings — and the YAML never contains a secret.

## Uploading run artefacts

The most useful per-PR artefact is the DQ summary JSON. Pair `sluice validate` with `actions/upload-artifact@v4` to attach it to the workflow run:

```yaml
- name: Upload DQ summaries
  if: always()           # upload even when validate failed (exit 2)
  uses: actions/upload-artifact@v4
  with:
    name: dq-summaries
    path: output/*-dq-summary.json
```

The same trick works for rejection CSVs — they're often the most valuable artefact a reviewer can look at.

## Per-environment config

For client engagements with multiple environments (dev, UAT, prod), use separate `.env`-style environments in GitHub Actions and a single set of pipeline YAMLs. The pipelines reference `${SOURCE_MSSQL}` and `${TARGET_PG}` regardless of environment; the workflow's `environment:` key picks which secret values to use.

```yaml
jobs:
  uat:
    environment: uat
    steps:
      - env:
          SOURCE_MSSQL: ${{ secrets.SOURCE_MSSQL }}   # resolved from `uat` environment
          TARGET_PG:    ${{ secrets.TARGET_PG }}
        run: npx sluice run customers.pipeline.yaml
```

## Scheduled runs

Use a `schedule:` trigger for periodic syncs. Pair with `mode: incremental` so each run only touches the records that changed:

```yaml
on:
  schedule:
    - cron: '0 2 * * *'   # 02:00 UTC every day

# pipeline.yaml
run:
  mode: incremental
  incrementalField: UPDATED_AT
```

The first run extracts everything; subsequent runs read `lastRunAt` from the state file and filter `WHERE UPDATED_AT >= lastRunAt`. Commit the state JSON back to the repo (or store it in an S3 bucket — see the [Plugin System](/sluice/guides/plugin-system/) for custom state backends, planned for v2).

## See also

- [Quickstart](/sluice/getting-started/quickstart/)
- [Writing a Pipeline YAML](/sluice/guides/writing-pipelines/)
- [Data Migration Patterns](/sluice/guides/data-migration-patterns/)
