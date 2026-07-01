# Legitify findings → posture-trend table

Worked example of the `json` source adapter: ingest a [Legitify](https://github.com/Legit-Labs/legitify)
org posture scan into a normalised findings table for trend analysis (Data Gubbins DAG-95).

## Why a reshape step

Legitify's JSON is an object keyed by policy (`content.<policy> = { policyInfo, violations[] }`),
not an array of records. `reshape-legitify.ps1` explodes it into one row per (policy, resource) —
the grain the trend table needs. This Legitify-specific step stays out of core Sluice; the generic
`json` adapter then loads the resulting array.

## Run it (synthetic sample)

```powershell
# 1. reshape raw Legitify JSON -> findings array (sample-findings.json is committed for convenience)
./reshape-legitify.ps1 -InputJson ./sample-legitify.json -OutputJson ./sample-findings.json

# 2. validate config, then run
sluice check ./legitify-findings.pipeline.yaml
sluice run   ./legitify-findings.pipeline.yaml   # -> output/legitify-trend.csv
```

## Against real scans

Point `-InputJson` at a dated scan from the private history
(`.github-private/legitify/history/legitify-*.json`, produced by the weekly workflow, DAG-91):

```powershell
./reshape-legitify.ps1 -InputJson C:\repos\dot-github-private\legitify\history\legitify-2026-07-14.json -OutputJson ./findings.json
```

**Do not commit real findings here** — this repo is public. Real scan output and the accumulated
trend table live in the private repo / DuckDB, not in these examples.

## Output columns

`scan_date, policy_name, namespace, severity, status, entity_type, resource, finding_key`

- `severity` normalised to upper-case (`CRITICAL|HIGH|MEDIUM|LOW`).
- `finding_key = policy|namespace|resource` — stable across scans, so appending each week's rows
  lets a downstream view compute open / closed / regressed transitions (feeds the Power BI trend
  dashboard, DAG-96). Cross-run diffing is a consumer concern, not this pipeline's job.
