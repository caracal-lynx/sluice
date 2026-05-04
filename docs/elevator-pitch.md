# Sluice — Elevator Pitch

> **Caracal Lynx Ltd.** | Owner: Michael Scott | Last updated: 2026-05-03
>
> Canonical home for the elevator pitch and supporting positioning copy. Referenced by [Phase 6 (README & Marketing)](PHASE-06-readme-and-marketing-spec.md) and [Phase 8 (GitHub Pages)](PHASE-08-github-pages-plan.md). Do not invent variant pitches in those docs — pull from here.

---

## One-line

**Sluice is a config-driven ETL toolkit that validates your data *before* it reaches its destination — not after. *Clean data flows through.***

---

## 30-second pitch

Data quality is the hidden blocker for both ERP migrations and AI adoption. The pattern is the same in both: messy source data hits a target system that can't tell good rows from bad, and someone has to clean up the mess afterwards.

Sluice flips that. You tell it where the data comes from, the quality rules it has to pass, and how each field maps to the destination — all in a YAML file. Sluice validates before the load, handles all the reformatting and field mapping along the way, and loads only the clean records to your destination. The bad rows go to a rejection report so you can fix the source.

The core CLI is open-source and free. Caracal Lynx sells the specialist parts on top — ERP-specific adapters, country/region rule packages, AI-assisted migration via the Sluice MCP Server, and full migration delivery as a service.

---

## Hero block (for README and docs site landing page)

> **Data quality is the hidden blocker for both migrations and AI adoption.**
>
> Sluice is a data migration and data quality tool that validates your data *before* it reaches its destination — not after. You describe the entire migration as a YAML file: where the data comes from, the quality rules it has to pass, how each field maps to the target. Sluice validates the source, transforms it, and loads only the clean records — the bad rows go to a rejection report so you can fix the source.
>
> *Clean data flows through.*

---

## Value props (three- or four-column block)

| Prop | Copy |
|---|---|
| **Config-driven** | Pipelines defined in YAML, no code required for standard migrations. |
| **Source & target agnostic** | Built-in adapters for MSSQL, PostgreSQL, CSV, XLSX, REST. ERP connectors (IFS, Business Central, BlueCherry) available as paid add-ons. |
| **Data quality first** | Validate before you load. Rejection CSVs and DQ summary reports built in. |
| **AI data readiness** | Use `sluice validate` as a pre-AI quality gate — know your data is fit for Copilot, Power BI, or any LLM tool *before* it causes damage. |

---

## The "AI angle" — for posts targeting AI-adopting orgs (rather than ETL audiences)

Most AI-readiness conversations end at "we need to clean our data first." Then nothing happens, because nobody has a tool that fits the gap between "data warehouse" and "spreadsheet." Sluice fits that gap: it's the config-driven validation layer that decides whether your data is fit for AI tools to act on it.

AI tools amplify your data quality — for better or worse. A Copilot agent confidently summarises a customer record built from rows where 30% of the addresses are wrong. A Power BI dashboard rolls up sales totals where currency codes weren't normalised. Sluice catches all of this *before* the data reaches the AI tool.

If you're adopting AI and you've never heard of ETL: that's fine. You don't need to learn ETL. You just need a quality gate. Sluice is the quality gate.

---

## "Commoditise the platform, sell the expertise" — for prospect conversations

The Sluice CLI engine is open-source and free under the Elastic Licence 2.0. You can use it for any internal data migration — your team, your data, your terms — at zero cost forever.

What Caracal Lynx sells, separately, is the layer of specialist knowledge that turns the engine into a delivered migration:

- **Application adapters** (IFS, Business Central, BlueCherry) — pre-built connectors that know each ERP's quirks
- **Country/region rule packages** — UK compliance rules, fashion/retail data standards
- **Client-specific plugins** — bespoke per-engagement deliverables
- **Sluice MCP Server** — AI-assisted migration: Claude turns into an active participant in your migration, scaffolding pipelines, inspecting schemas, iterating on DQ rules
- **Migration delivery** — full end-to-end service, delivered by Caracal Lynx

The split is deliberate: the engine is open, the knowledge is not.

---

## Tagline

**"Clean data flows through."**

This is the load-bearing tagline. Use it in headers, footers, social cards, slide decks. Don't replace or reword.

---

## Audiences (when adapting the pitch)

| Audience | What to lead with |
|---|---|
| Data engineers / ETL practitioners | The YAML config and DQ engine — they recognise the pattern |
| ERP project managers | "Migrate before go-live, not on go-live weekend" — the rejection report is your insurance |
| AI / Copilot adopters | "Your AI is only as good as your data" — Sluice is the pre-AI quality gate |
| Business owners / non-technical | The 30-second pitch above; skip the technical framing |
| Open-source / GitHub visitors | The hero block + the extension model + a working YAML example in under 20 lines |

---

## Source fragments (where the pitch comes from)

This file consolidates positioning copy that previously lived scattered across:

- [Context.md](Context.md) — mission and constraints
- [open-sourcing-sluice.md](open-sourcing-sluice.md) — the "commoditise the platform" framing and the AI angle
- [PHASE-08-github-pages-plan.md §Home](PHASE-08-github-pages-plan.md) — the original 30-second pitch and three-column value props
- [README.md](../README.md) — the conversational "What is this thing?" section

When refining the pitch, keep this file the source of truth. Update it here, and let the README and docs site pull from here.

---

*Caracal Lynx Ltd. — SC826823 — Gretna, Scotland*
