---
title: Data Migration Patterns
description: Real-world data migration patterns Sluice supports — legacy modernisation, ERP-to-ERP, multi-source consolidation, AI data readiness.
---

Every migration looks unique up close, but a small set of patterns shows up in every project. This page maps each pattern to the Sluice features that handle it, with references to the relevant page.

## Common migration challenges

| Challenge                          | The Sluice answer                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Data quality in legacy systems** | Front-load the rules. Configure `dq:` so rejections are caught before the load, not after.      |
| **Date format mismatches**         | `type: date` with explicit `format:` (dayjs tokens). Targets reformat with `target.dateFormat`. |
| **Lookup / enum mapping**          | `type: lookup` with a CSV or SQL-backed lookup table. Cached in memory once per run.            |
| **Encoding issues**                | `source.encoding` accepts any Node-supported encoding (`utf-8`, `latin1`, `windows-1252`).      |
| **Duplicate records**              | `dq.rules` with a `unique` check on the primary-key field, severity `critical`.                 |
| **Broken referential integrity**   | `notNull` + `pattern` on FK fields, severity `critical`. Catches orphaned rows.                 |

## Pattern 1 — Legacy database modernisation

Lift data out of an ageing SQL Server or flat-file system into a modern platform (PostgreSQL, Snowflake, BigQuery, …). The pattern:

1. **Profile** the source first: `sluice profile <pipeline.yaml>` runs Extract + column-level summary statistics so you know what you're dealing with before you write any rules.
2. **Iterate DQ rules** against staged data: `sluice validate` is fast and idempotent because the rejection CSV regenerates from the staged extract — no need to re-extract.
3. **Transform** to the new shape with `transform.fields[]`, including `lookup`s for any code translation.
4. **Load** to the modern target. Use the built-in `pg` adapter for PostgreSQL, or write a Tier 2/3 plugin for anything else.

## Pattern 2 — ERP-to-ERP migration

Switching ERPs is the highest-stakes flavour of migration: every entity has a strict shape, dates are formatted differently, codes don't match, and the consequences of a bad load are visible in the customer-facing system within hours.

Sluice's pattern:

1. One pipeline YAML per entity (customers, vendors, items, BOMs, purchase orders, sales orders, …). Pipelines stay independent so you can run them in dependency order.
2. **Strict DQ on identity columns.** Every `*_NO`/`*_CODE` field gets `notNull` + `unique` + a `pattern` rule.
3. **Lookup tables for every code translation** — currency, country, account manager, division, season. The lookup CSV is checked into the repo so changes are reviewable.
4. **Target-specific column order and date format** — IFS, Business Central, and BlueCherry each demand different shapes. Use the appropriate paid adapter (see [Commercial Support](/sluice/commercial-support/)).
5. **Dry-run first.** `--dry-run` runs DQ + transform without loading. This is the safest way to iterate.

The IFS, Business Central, and BlueCherry adapters Caracal Lynx maintains were built precisely because hand-rolling these targets the first time is the most painful part of an ERP migration.

## Pattern 3 — Multi-source consolidation

Sometimes the source isn't one system — it's three. The CRM has the customer name and email; the ERP has the credit limit; an Excel spreadsheet from finance has the customer category. You need to merge them by customer code into one record per customer.

Sluice's multi-source mode handles this via `sources:` + `merge:`:

```yaml
sources:
  - id: crm
    priority: 1
    adapter: rest
    endpoint: ${CRM_API}/customers
    pagination: { type: offset, pageSize: 100, totalField: meta.total, dataField: data }
  - id: erp
    priority: 2
    adapter: mssql
    connection: ${ERP_DB}
    query: SELECT CUST_CODE, CREDIT_LIMIT FROM dbo.Customers
  - id: finance
    priority: 3
    adapter: xlsx
    file: ./data/customer-categories.xlsx
    sheet: Categories
    rename:
      Customer Number: CUST_CODE
      Tier: CATEGORY

merge:
  key: CUST_CODE
  strategy: coalesce
  fieldStrategies:
    - { field: CATEGORY, source: finance } # always take CATEGORY from finance
  conflictLog: ./output/customer-merge-conflicts.csv
```

Four built-in strategies cover the common cases:

- **`coalesce`** — first non-null value wins, priority-ordered.
- **`priority-override`** — highest-priority source wins, even if null.
- **`union`** — all rows from all sources, deduped by key.
- **`intersect`** — only rows present in **all** sources.

Per-field overrides are common — most fields should `coalesce`, but `CATEGORY` should always come from finance. See [How It Works](/sluice/architecture/how-it-works/) for the merge flow diagram.

## Pattern 4 — Incremental sync

Long-running migrations — or steady-state integrations — don't want to re-extract everything every day. With `mode: incremental`:

```yaml
run:
  mode: incremental
  incrementalField: UPDATED_AT
```

The first run extracts everything and writes `lastRunAt` into the state file. Subsequent runs filter `WHERE UPDATED_AT >= lastRunAt`. Commit the state JSON to the repo (or store it externally) so the next run resumes from the right point.

For multi-source pipelines, set `merge.incrementalSource: <id>` to mark which source drives the incremental window — the others run full each time.

## Pattern 5 — Data quality auditing

You don't have to **load** anywhere. `sluice validate` runs Extract + DQ and writes the rejection CSV and DQ summary; that's a perfectly good way to audit existing data quality without a target system.

Use this when:

- A client wants a "data readiness" report before committing to a migration project.
- You're piloting an AI tool (Power BI, Copilot, an LLM agent) and need to know whether the source data is fit for purpose.
- You're under regulatory pressure to demonstrate data quality and need a reproducible audit trail.

The DQ summary JSON is designed to be a CI artefact: drop it into a GitHub Actions step and it becomes a per-PR data-quality report. See [CI/CD Integration](/sluice/guides/ci-cd/).

## Pattern 6 — AI data readiness

> AI tools amplify your data quality — for better or worse.

Most AI-readiness conversations end at "we need to clean our data first," and then nothing happens because nobody has a tool that fits the gap between "data warehouse" and "spreadsheet". Sluice fits that gap.

The recipe:

1. Point Sluice at every source the AI tool will read.
2. Configure DQ rules that match the assumptions the AI tool makes (e.g. address formats, date ranges, currency normalisation, mandatory fields).
3. Run `sluice validate` regularly — daily, weekly — and treat the rejection CSV as a backlog the data owners need to clear.
4. Promote validated data to the AI-facing surface only after DQ has run.

For organisations adopting AI seriously, Caracal Lynx delivers this as the **AI Data Readiness Audit** service. See [Commercial Support](/sluice/commercial-support/).

## Pattern 7 — CSV/XLSX bulk import with validation

A bulk import from a spreadsheet should never be a one-shot manual upload. Wrap it in a Sluice pipeline:

- Source = `csv` or `xlsx`.
- DQ runs the same rules whether the data came from SQL Server or from a spreadsheet — so the receiving system gets the same quality bar.
- Target can be PostgreSQL, an ERP via paid adapter, or a generic CSV bound for a downstream tool.

This pattern is how most onboarding flows should run. The cost is a YAML file; the saving is every customer-support ticket that would have come from bad spreadsheet data.

## See also

- [Quickstart](/sluice/getting-started/quickstart/)
- [Writing a Pipeline YAML](/sluice/guides/writing-pipelines/)
- [Use Cases](/sluice/use-cases/) — the same patterns from a buyer's perspective
