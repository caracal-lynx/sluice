---
title: Use Cases
description: Range of data migration scenarios Sluice supports — legacy modernisation, ERP migration, ongoing sync, AI data readiness, and more.
---

Sluice was built for ERP data migrations, but the engine is deliberately generic. Any time you need to **extract structured data, validate it, transform it, and load it elsewhere — with the rules and mappings written down in one place — Sluice fits**. Below are the patterns we see most often.

## Legacy system migration

Moving data out of an ageing SQL Server, AS/400, or flat-file system into a modern platform. The source is often messy and undocumented; the target enforces strict rules.

Sluice's value here:

- The DQ engine catches data quality problems **before** the target rejects them, and writes a rejection CSV the source team can act on.
- Lookup tables translate legacy codes to modern enums without bespoke code.
- The Pipeline YAML is the documentation — every transformation is in one file, reviewable and version-controllable.

## Platform-to-platform migration

Switching from one application to another (CRM A → CRM B, e-commerce platform → headless commerce, ticketing system → support desk). Field names rarely match; date formats and identifier formats often differ; the target has its own validation rules.

Sluice's value here:

- One pipeline YAML per migrated entity keeps the work scoped and parallelisable.
- Field-level transforms handle every rename, format change, and code translation.
- The same pipelines run in dev, UAT, and prod with environment-specific secrets.

## ERP data migration

Structured migration into ERP systems such as **IFS**, **Microsoft Dynamics 365 Business Central**, or **BlueCherry** (CGS). ERP imports are unforgiving — column order, date format, and entity ordering all matter.

ERP-specific adapters are paid add-ons from Caracal Lynx — see [Commercial Support](/sluice/commercial-support/). They handle:

- Required-column validation **before** the load (no half-imported rows).
- ERP-specific date formats and column orderings.
- OAuth 2.0 (Business Central), CSV with strict headers (BlueCherry), or no-header CSV (IFS).

## Data warehouse loading

Extract from operational databases, validate, and load into an analytical store (PostgreSQL, Snowflake, BigQuery). Sluice's DQ phase catches the bad rows before they end up in dashboards. Use the built-in `pg` target, or write a Tier 3 plugin for warehouses Sluice doesn't natively support.

## Ongoing data sync

Scheduled pipeline runs for keeping systems in sync — overnight, hourly, or on a webhook. Combine `mode: incremental` with a GitHub Actions `schedule:` trigger and you have a low-maintenance integration job that emits a DQ summary every run.

## Data quality auditing

Run `sluice validate` against existing data **without loading it anywhere**. You get a rejection CSV and a DQ summary report — useful for:

- Pre-migration data readiness assessments.
- Regulatory or compliance audits.
- Pre-AI quality gates.

No target system needed; the rejection CSV is the deliverable.

## AI data readiness

Validate your data against a quality ruleset **before** feeding it to Microsoft Copilot, Power BI, or any LLM tool.

> AI amplifies your data quality — for better or worse. Sluice tells you which, before your AI tools do.

A Copilot agent that confidently summarises a customer record built from rows where 30% of the addresses are wrong is a problem. A Power BI dashboard rolling up sales totals where currency codes weren't normalised is a problem. Sluice catches these failure modes before they reach the AI tool.

For organisations adopting AI seriously, Caracal Lynx delivers this as the **AI Data Readiness Audit** service. See [Commercial Support](/sluice/commercial-support/).

## CSV/XLSX bulk import

Structured imports from spreadsheet exports with full validation **before** load. Whether the spreadsheet is a one-off customer onboarding file or a recurring vendor price list, wrap it in a Sluice pipeline and you get the same quality bar as your database-sourced loads — for the cost of one YAML file.

## Multi-source consolidation

When the source isn't one system but three (CRM + ERP + spreadsheet), Sluice's multi-source mode merges by a configurable key with four built-in merge strategies (`coalesce`, `priority-override`, `union`, `intersect`) plus per-field overrides. See [Data Migration Patterns → Pattern 3](/sluice/guides/data-migration-patterns/) and [How It Works](/sluice/architecture/how-it-works/).

## What Sluice is **not** for

- **Real-time / streaming ingestion.** Sluice is batch-mode by design. For sub-minute latencies, use Kafka / Pub/Sub / Kinesis.
- **A data lake or warehouse.** DuckDB is used as a local staging store, not an analytical platform.
- **A web UI.** Sluice is a CLI; everything is config-as-code.
- **A multi-tenant SaaS.** It's a consultant's toolkit and a CI/CD job runner — not a hosted product.

## Talk to us

If you're not sure whether Sluice fits your scenario, email **[sluice@caracallynx.com](mailto:sluice@caracallynx.com)** with a one-paragraph description and we'll come back to you within two working days. There's no hard sell — if Sluice isn't the right tool, we'll point you somewhere better.
