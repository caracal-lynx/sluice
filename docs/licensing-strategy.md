# Sluice — Licensing Strategy

> **Context:** Caracal Lynx wants businesses to use Sluice freely for their own data migrations, but to prevent other consultants from taking it and reselling it as a competing service. This document analyses the options and makes a recommendation.

---

## The Core Tension

| Use Case | Allowed? |
|----------|---------|
| A business runs Sluice internally for their own migration | ✅ Yes |
| A business embeds Sluice in their own internal tooling | ✅ Yes |
| A consultant uses Sluice to deliver a migration project for a client | ❌ No |
| Someone white-labels Sluice and sells it as a product | ❌ No |

The tricky bit legally is that "using software to deliver a service" and "selling the software" are different things, and most licences only restrict the latter.

---

## Options

### Option 1 — Apache 2.0 + Commons Clause *(simplest)*

The [Commons Clause](https://commonsclause.com/) is an addendum bolted onto a permissive licence. It adds one restriction: you cannot *sell* the software. "Sell" is defined broadly enough to cover "providing it to third parties as a service."

```
Apache 2.0 + Commons Clause (the "Clause")

The Clause: the licence granted above does not include the right 
to Sell the Software. "Sell" means providing to third parties, 
for a fee or otherwise, a product or service whose primary value 
comes from the Software.
```

**Pros:** Simple, well-understood, easy to add. Already used by Redis Labs, Percona, and others.

**Cons:** Not OSI-approved (so you cannot call it "open source" — only "source available"). The definition of "primary value" is fuzzy and could be disputed.

---

### Option 2 — Elastic Licence 2.0 (ELv2) *(clean and modern)*

The [Elastic Licence 2.0](https://www.elastic.co/licensing/elastic-license) is a purpose-built "source available" licence. Its key restriction:

> *You may not provide the Software to third parties as a hosted or managed service, where the service provides users with access to any substantial set of the features or functionality of the Software.*

**Pros:** Short (one page), clear language, written specifically to prevent competing services. Widely understood in the developer community.

**Cons:** Not OSI "open source." A pure-play consultant running Sluice pipelines for a client could argue they're providing *migration services* and Sluice is just a tool — a lawyer would need to test that edge.

---

### Option 3 — Functional Source Licence (FSL) *(with a sunset)*

The [Functional Source Licence](https://fsl.software/) (2023, used by Gitbutler) is explicit about the non-compete angle:

> *You may not use the Software to provide a competing service.*

It also has a **4-year sunset** — after 4 years the code automatically converts to Apache 2.0. A reasonable fit for a consultancy tool: competitive advantage will have evolved by then.

**Pros:** Most direct language for this use case. The sunset clause is a goodwill signal to the community.

**Cons:** Very new, less tested in courts. Still not OSI "open source."

---

### Option 4 — Dual Licence *(most control, most complexity)*

Offer two licences simultaneously:

- **AGPL-3.0** for free use — copyleft means anyone who modifies and distributes must open-source their changes. Makes it unattractive for commercial consultancies to use without paying, because they'd have to open-source their client deliverables.
- **Commercial Licence** from Caracal Lynx — pays a fee, removes copyleft restrictions, allows proprietary use.

Businesses using Sluice internally likely won't trigger AGPL (internal use doesn't require distribution). Consultants delivering to clients *do* trigger it — they'd need a commercial licence.

**Pros:** OSI-compliant (AGPL is a real open source licence). Strong legal precedent. Creates a revenue stream.

**Cons:** Most complex to administer. Requires a Contributor Licence Agreement (CLA) so contributors assign rights to Caracal Lynx — otherwise you cannot dual-licence their contributions.

---

## Licence Comparison

| | Apache 2.0 + Commons Clause | ELv2 | FSL | Dual (AGPL + Commercial) |
|--|--|--|--|--|
| OSI "open source" | ❌ | ❌ | ❌ | ✅ (AGPL tier) |
| Blocks competing consultants | ⚠️ Partial | ✅ | ✅ | ✅ |
| Allows internal business use | ✅ | ✅ | ✅ | ✅ |
| Legal precedent | Medium | Medium | Low (new) | High |
| Admin complexity | Low | Low | Low | High (CLA needed) |
| Revenue potential | ❌ | ❌ | ❌ | ✅ |

---

## Enforceability — The Honest Reality

Whatever licence you choose, enforcement is hard for a small company. The real deterrents are:

**Reputational** — A consultant using Sluice to compete with Caracal Lynx would have to admit they're using your tool. That's awkward in the data migration consulting industry.

**Legal standing** — A clear licence gives you grounds to send a cease-and-desist letter. Most violations stop there without going to court.

**Practical obscurity** — If a competitor is using Sluice without crediting you or contributing back, they're the ones with the awkward explanation, not you.

No licence is a guarantee. The goal is to make violation clearly wrong in writing, so you have leverage if it ever arises.

---

## Decision for Caracal Lynx

**✅ CONFIRMED (April 2026): Elastic Licence 2.0 (ELv2)**

ELv2 is one page, plain English, widely understood, and its restriction maps almost exactly to the stated intent. The decision has been made — this is no longer a recommendation, it is the chosen licence for the Sluice open-source core.

Companion document [`docs/licensing-faq.md`](licensing-faq.md) provides the plain-English explanation that most users will read instead of the licence itself. _(Originally placed at the repo root as `LICENCE-FAQ.md`; relocated to `docs/` post-Phase 4 because the `LICEN[CS]E*` filename pattern caused GitHub's licensee tool to flag it as a spurious second "Unknown licence" alongside `LICENSE`.)_

If Sluice grows a meaningful contributor community and a commercial licence revenue stream becomes attractive, revisit dual licensing at that point. For now, ELv2 is the right balance of clarity, simplicity, and protection.

---

## Implementation Steps (Phase 5)

These steps are completed during Phase 5 (repo restructure and open-source launch). See `SLUICE-IMPLEMENTATION-PLAN.md` for full context.

1. Download the [ELv2 licence text](https://www.elastic.co/licensing/elastic-license) and save as `LICENSE` in the repo root
2. Add the licensing-FAQ companion document at `docs/licensing-faq.md` (already written — see above). _(For Phase 5 itself, this was placed at the repo root as `LICENCE-FAQ.md`; relocated post-Phase 4.)_
3. Add licence header to all source files in `packages/core/src/`:
   ```typescript
   // SPDX-License-Identifier: Elastic-2.0
   // Copyright (c) 2026 Caracal Lynx Ltd.
   ```
4. Update `package.json`: `"license": "Elastic-2.0"`
5. Minute the licensing decision as a Caracal Lynx board resolution (Phase 0)
6. Take legal advice before the first public release — this document is analysis, not legal advice

**Note on private packages:** The country/region rule packages (`etl-rules-uk`, `etl-rules-fashion`), `@caracal-lynx/sluice-enrich` (the private paid enrichment service), application adapter packages, and the Sluice MCP Server are **not** covered by ELv2. They are proprietary commercial packages published as private npm packages under `@caracal-lynx`. Clients access them under a separate commercial arrangement with Caracal Lynx.
