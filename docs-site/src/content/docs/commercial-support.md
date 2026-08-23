---
title: Commercial Support
description: Sluice is built and maintained by Caracal Lynx Limited. Paid services include AI Data Readiness Audits, the Enrich service, domain rule packages, the MCP server, and full migration delivery.
---

Sluice is open source and free under the [Elastic Licence 2.0](https://github.com/caracal-lynx/sluice/blob/master/LICENSE). It is built and maintained by **Caracal Lynx Limited** (Scottish company SC826823) — an IT and data consultancy specialising in data migrations and data quality for organisations adopting AI tools.

Everything the CLI does is in the open-source core. That includes:

- **All seven source adapters** — MSSQL, PostgreSQL, CSV, XLSX, REST, Odoo CSV, JSON.
- **All five target adapters** — including the `ifs`, `bluecherry`, and `bc` ERP adapters.
- The DQ engine, the Prep phase, the transform engine, the multi-source merge engine, and the three-tier plugin system.

There are no feature gates and no licence checks. Anything documented on this site works in a plain `npm install @caracal-lynx/sluice`, unless it is explicitly listed as a paid add-on below.

What Caracal Lynx sells, separately, is the layer of specialist knowledge that turns the engine into a delivered migration. We maintain a small set of premium add-ons and offer hands-on services on top.

## Paid services

### AI Data Readiness Audit

For organisations adopting Microsoft Copilot, Power BI, or any LLM-based tooling. Caracal Lynx connects Sluice to your data sources, builds the data quality ruleset, runs it, and delivers a clear report on what's AI-ready and what needs fixing first. Most reports take under a fortnight.

> AI tools amplify your data quality — for better or worse. Sluice tells you which, before your AI tools do.

### Enrich Service

The `@caracal-lynx/sluice-enrich` private package adds the [**Enrich phase**](/sluice/reference/prep-and-enrich/#enrich--phase-4a) between Extract and DQ. It runs async API lookups in parallel — EU VAT validation via VIES, UK VAT via HMRC, UK Trade Tariff lookups — and writes the enriched columns straight back into staging so downstream DQ rules can validate against them. Designed for batch-friendly third-party APIs with rate limits and caching baked in.

### Domain Rule Packages

Reusable DQ rule packs for domains where the rules are non-obvious or burdensome to maintain:

- **`@caracal-lynx/etl-rules-uk`** — UK postcode validation, UK VAT format, UK CRN format, UK bank sort-code/account-number rules.
- **`@caracal-lynx/etl-rules-fashion`** — fashion and retail data standards (size grids, colour codes, season-code patterns).

### Sluice MCP Server

`@caracal-lynx/sluice-mcp` — a private Model Context Protocol server that turns Claude (or Claude Code) into an active participant in a migration engagement rather than a passive advisor. Sixteen tools spanning pipeline execution, schema inspection, config authoring, and scaffolding. Provided to clients as part of a paid Sluice-assisted migration.

> Without the MCP server: Claude generates YAML → human runs it → human pastes results back → Claude advises.
> With the MCP server: Claude generates YAML → executes it → inspects results → self-corrects. Human approval only required before live runs.

### ERP Migration Delivery

The `ifs`, `bc`, and `bluecherry` adapters ship in the open core — you do not need to buy anything to use them. What is hard about an ERP migration is not the adapter; it is knowing which of the two hundred columns in `CustomerInfo` your client actually has to populate, in what order, and what the ERP does when one of them is wrong. That is what we sell.

### Migration Delivery

Full end-to-end data migrations delivered by Caracal Lynx. We bring the engine, the adapters, the rule packages, and the engineering hours. Typical engagements range from single-entity refreshes to full ERP go-live programmes.

### Custom Plugin Development

Bespoke rules, adapters, transforms, and merge strategies for source systems unique to your business. Delivered as a private npm package or a TypeScript file plugin checked into your client repo.

## Get in touch

Email **[sluice@caracallynx.com](mailto:sluice@caracallynx.com)** with a one-paragraph summary of your migration and we'll come back to you within two working days. There is no hard sell — we'll tell you whether Sluice is the right fit for your scenario, and if it isn't, we'll point you at someone better placed.

For broader Caracal Lynx engagements, [caracallynx.com](https://caracallynx.com) is the company site.
