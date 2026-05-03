# Sluice — Phase 6: README & Marketing (Spec)

> 🔴 **Status: BLOCKED by Phase 5.** This document specifies how Phase 6 will be executed once Phase 5 (Repo Restructure & Open-Source Launch) lands. Do **not** start Phase 6 work until the public `caracal-lynx/sluice` repository exists, ELv2 is applied, and the hygiene files (`LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `LICENCE-FAQ.md`) are committed at the repo root.
>
> **Owner:** Caracal Lynx Limited · Michael Scott
> **Estimated effort:** 1 week
> **Master plan reference:** [SLUICE-IMPLEMENTATION-PLAN.md §10](./SLUICE-IMPLEMENTATION-PLAN.md#10-phase-6--readme--marketing)

---

## Context

The README at the root of `caracal-lynx/sluice` is the front door to the open-source project. Once the repo is public, three audiences arrive at it:

1. **Developers evaluating an ETL tool for their migration.** They need to go from "what is this?" to a working `sluice run` in under 10 minutes, or they leave.
2. **Existing or prospective Caracal Lynx clients** doing due-diligence on the tooling underneath the engagement they're being sold.
3. **AI-assisted migration audiences** (a separate persona from #1) who don't think of themselves as ETL users but need exactly the data-quality gating Sluice provides.

Phase 6 turns the current internal README — which still carries a `License: private` badge and no commercial-services section — into a public-facing front door that does three jobs simultaneously: convert curious developers, signpost paid Caracal Lynx services without being intrusive, and give the community an obvious on-ramp (Issues, Discussions, contributing).

The "& Marketing" half is deliberately small in scope: this phase covers the README, the npm package metadata, and the GitHub repository About panel. **Launch-day amplification (HN, Reddit, LinkedIn, blog post, social card) is explicitly out of scope** and is captured below as a deferred Phase 6.5.

---

## Goals & non-goals

### Goals

- A README that takes a curious visitor → Quickstart → first successful `sluice check` against a fixture pipeline in under 10 minutes.
- An obvious, well-positioned "Caracal Lynx Professional Services" section that converts the right readers into commercial enquiries without burying the open-source story.
- Clear community on-ramps: Issues, Discussions, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- npm package metadata (`package.json`) that renders correctly on npmjs.com.
- GitHub repository "About" panel: description, website URL, topics — all set.

### Non-goals (deferred)

- Full GitHub Pages documentation site → **Phase 8**.
- npm publish automation, Changesets, Renovate cascade → **Phase 7**.
- Launch-day announcements (HN/Reddit/LinkedIn/blog), social-share card image, OpenGraph metadata → **Phase 6.5 — Launch Announcement** (separate doc to be authored when Phase 6 nears completion).
- Translating the README → out of scope; English only at launch.

---

## Prerequisites (must be true before starting Phase 6)

| # | Prerequisite | Owned by | Verify with |
|---|---|---|---|
| 1 | Repo `caracal-lynx/sluice` is **public** on GitHub | Phase 5 | `gh repo view caracal-lynx/sluice --json visibility` |
| 2 | `LICENSE` (Elastic-2.0 text) committed at repo root | Phase 5 | `test -f LICENSE` |
| 3 | `LICENCE-FAQ.md` committed at repo root | Phase 5 | `test -f LICENCE-FAQ.md` |
| 4 | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` committed | Phase 5 | `ls CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md` |
| 5 | Every `.ts` file in `src/` carries the `SPDX-License-Identifier: Elastic-2.0` header | Phase 5 | `grep -L "SPDX-License-Identifier: Elastic-2.0" src/**/*.ts` (must return empty) |
| 6 | `package.json` `"license"` field is `"Elastic-2.0"` | Phase 5 | `jq -r .license package.json` |
| 7 | Canonical elevator-pitch text exists at `docs/elevator-pitch.md` | **Michael (this phase)** | `test -f docs/elevator-pitch.md` |
| 8 | Banner and logo images render on github.com | Pre-existing | Open `README.md` on github.com and visually confirm |

If any prerequisite is missing when this phase begins, **stop and resolve it before editing the README**.

---

## What's already in the README (and what stays)

The current `README.md` is in good shape. The Phase 6 changes are largely **additive**, not a rewrite. Sections to **keep verbatim**:

- Banner image (`images/sluice_banner.png`) and "sluice that controls the flow of data" tagline
- "🤔 What is this thing?" introduction
- "✨ What it does" ASCII flow diagram
- "🏗️ Architecture" Mermaid diagrams (single-source + multi-source)
- "🧰 Tech Stack" table
- "🚀 Quick Start" CLI command list
- "CLI flags" and "Exit codes" tables
- Existing pipeline-config format documentation (sections from `📄 Pipeline Config Format` onwards)

---

## Section-by-section README delta

| Section | Action | Detail |
|---|---|---|
| Badge row (lines ~7–9) | **Modify** | Remove the `License: private` badge. Add `License: Elastic-2.0` badge linking to `LICENCE-FAQ.md`. Add npm-version badge (`https://img.shields.io/npm/v/@caracal-lynx/sluice`). Conditionally add a `Docs` badge once Phase 8 ships (TODO marker until then). |
| Above "🤔 What is this thing?" | **Add** | Elevator-pitch hero block sourced from `docs/elevator-pitch.md` — see §"Elevator pitch handling" below. |
| Banner / tagline | Keep | No change. |
| "🤔 What is this thing?" | Keep | No change. |
| "✨ What it does" | Keep | No change. |
| "🏗️ Architecture" | Keep | No change. |
| "🧰 Tech Stack" | Keep | No change. |
| **After Tech Stack, before Quick Start** | **Add** | New section: "🧩 Extension model" — three-tier callout (Tier 1 YAML composite rules / Tier 2 file-based plugins / Tier 3 npm-package plugins). Links to [PLUGINS.md](../PLUGINS.md). One-paragraph framing + 3-row table. |
| **Above the existing CLI commands inside "🚀 Quick Start"** | **Add** | Minimal "Hello world" YAML snippet (csv → csv, ≤ 20 lines) — see §"Quickstart YAML snippet" below. |
| Existing "🚀 Quick Start" CLI block | Keep | No change to CLI commands themselves. |
| "📄 Pipeline Config Format" → end | Keep | No change. |
| **At end of README** | **Add** | New sections (in this order): "🏢 Caracal Lynx Professional Services" (paid services) · "🤝 Community" · "🔐 Security" · "⚖️ Licence" · "🏷️ About". |

---

## Elevator pitch handling

The elevator-pitch text is a **shared asset** referenced by both Phase 6 (README) and Phase 8 (GitHub Pages site landing page). Its canonical home is `docs/elevator-pitch.md`, which **must exist before Phase 6 starts** (prerequisite #7).

In this spec we deliberately do **not** invent or finalise the pitch wording. The README will use a placeholder until the canonical file lands:

```markdown
> [TODO: insert elevator pitch from docs/elevator-pitch.md]
>
> Until that file exists, this block stays as a comment so the rest of the README can be reviewed.
```

The pitch should cover, at minimum: the problem (data quality is the hidden blocker for migrations and AI adoption); the solution (validate before load, not after); the value proposition ("Clean data flows through"); and the AI-readiness angle. Reference fragments are already in [docs/Context.md](./Context.md), [docs/open-sourcing-sluice.md](./open-sourcing-sluice.md), and [docs/PHASE-08-github-pages-plan.md §Home](./PHASE-08-github-pages-plan.md) — but the canonical text lives in `docs/elevator-pitch.md` once it's authored.

---

## Quickstart YAML snippet

**Constraints:**

- ≤ 20 lines.
- Must render readably in GitHub's narrow column without horizontal scroll.
- `csv` source → `csv` target (no DB connection strings, no `${ENV_VAR}` indirection — newcomers don't have either yet).
- Must reference a fixture path that exists in the repo so a copy-paste actually executes.

**Source candidates** (pick the cleanest at execution time):

- [examples/inventory-sync.pipeline.yaml](../examples/inventory-sync.pipeline.yaml)
- [examples/tm2-example.pipeline.yaml](../examples/tm2-example.pipeline.yaml)
- [tests/fixtures/](../tests/fixtures/) — any existing CSV-to-CSV fixture used by integration tests

If none of the existing fixtures distil to ≤ 20 lines, author a new minimal one at `examples/hello-world.pipeline.yaml` plus matching `examples/data/hello-world.csv`. The README snippet then references that file.

**Example shape (for illustration — final wording deferred to execution):**

```yaml
pipeline:
  name: hello-world
  client: demo
  version: "1.0"
  entity: Customer

source:
  adapter: csv
  file: ./examples/data/hello-world.csv

dq:
  rules:
    - field: email
      checks:
        - { type: notNull, severity: critical }
        - { type: email,   severity: warning  }

transform:
  fields:
    - { from: email, to: Email, type: string, cleanse: trim|lowercase }

target:
  adapter: csv
  output: ./output/hello-world-clean.csv
```

---

## Paid services section — exact placement and copy

Insert as a top-level `##` section at the end of the README, between "📄 Pipeline Config Format" and the new "🤝 Community" section.

**Title:** `## 🏢 Sluice + Caracal Lynx Professional Services`

**Lead sentence (one line above the table):**

> The Sluice core CLI is open-source and free to use. Caracal Lynx offers additional paid services built on top of it:

**Table (verbatim from [SLUICE-IMPLEMENTATION-PLAN.md §10](./SLUICE-IMPLEMENTATION-PLAN.md#10-phase-6--readme--marketing)):**

| Service | What it is |
|---|---|
| **Enrichment Service** | Async API lookups (EU VAT, UK VAT, trade tariff) — fills gaps in source data |
| **Application Adapters** | Pre-built ERP adapters (IFS, Business Central, BlueCherry) |
| **Domain Rule Packages** | UK compliance rules, fashion/retail data standards |
| **Client-Specific Plugins** | Bespoke plugins tailored to your source system and data model |
| **Sluice MCP Server** | AI-assisted migration using Claude — agentic pipeline authoring, live schema inspection, automatic DQ iteration |
| **Migration Delivery** | Full end-to-end data migration, delivered by Caracal Lynx |

**Contact block (under the table):**

```
📧 michael.scott@caracallynx.com
🌐 caracallynx.com
```

> ⚠️ **Risk flag:** the paid-services table is drafted but **not legally reviewed**. The Phase 0 audit covered the open-sourcing decision (board resolution + client contracts + GDPR), not commercial marketing copy. Confirm with Michael that the table is fit to publish before this section goes live.

---

## Community / Security / Licence / About sections

After the paid-services section, append the following four short sections:

### 🤝 Community

```markdown
- 🐛 [Report a bug or request a feature](https://github.com/caracal-lynx/sluice/issues/new/choose)
- 💬 [Ask a question or share a use case](https://github.com/caracal-lynx/sluice/discussions)
- 🤲 [Contributing guide](CONTRIBUTING.md)
- 🤝 [Code of Conduct](CODE_OF_CONDUCT.md)
```

### 🔐 Security

```markdown
Found a vulnerability? Please **do not** open a public issue. See [SECURITY.md](SECURITY.md) for the disclosure process.
```

### ⚖️ Licence

```markdown
Sluice is licensed under the [Elastic License 2.0](LICENSE). See [LICENCE-FAQ.md](LICENCE-FAQ.md) for a plain-English explainer of what you can and can't do with it. Short version: use it freely for your own data migrations; don't resell it as a hosted service or strip the licence headers.
```

### 🏷️ About

```markdown
Built and maintained by [Caracal Lynx Limited](https://caracallynx.com) (SC826823) — Gretna, Scotland.
*Clean data flows through.*
```

---

## Marketing artefacts checklist (the "& Marketing" half)

Beyond the README itself, Phase 6 owns the following one-off setup tasks:

| # | Artefact | Action | Verify |
|---|---|---|---|
| M1 | GitHub repo description | Set to: *"Config-driven ETL toolkit for ERP data migrations. Clean data flows through."* | `gh repo view caracal-lynx/sluice --json description` |
| M2 | GitHub repo "About" website URL | Set to `https://caracallynx.com` (swap to docs site once Phase 8 ships) | `gh repo view caracal-lynx/sluice --json homepageUrl` |
| M3 | GitHub topics | Confirm Phase 5 set: `etl`, `data-migration`, `erp`, `typescript`, `yaml`, `duckdb`, `cli`. Add any missing ones. | `gh repo view caracal-lynx/sluice --json repositoryTopics` |
| M4 | GitHub Sponsors | Explicitly **opt out**. No `FUNDING.yml`. Caracal Lynx routes commercial conversations through the paid-services contact, not Sponsors. | `test ! -f .github/FUNDING.yml` |
| M5 | `package.json` `description` | Match the GitHub repo description (M1) for consistency. | `jq -r .description package.json` |
| M6 | `package.json` `keywords` | At minimum: `["etl", "data-migration", "erp", "yaml", "duckdb", "cli", "typescript"]`. | `jq -r .keywords package.json` |
| M7 | `package.json` `homepage` | `https://github.com/caracal-lynx/sluice#readme` (swap to docs site once Phase 8 ships). | `jq -r .homepage package.json` |
| M8 | `package.json` `bugs` | `{ "url": "https://github.com/caracal-lynx/sluice/issues" }` | `jq -r .bugs package.json` |
| M9 | `package.json` `repository` | `{ "type": "git", "url": "git+https://github.com/caracal-lynx/sluice.git" }` | `jq -r .repository package.json` |
| M10 | npm package preview | `npm pack --dry-run` shows the README will render correctly on npmjs.com (no broken images, no dangling relative links). | Visual check of the dry-run output |
| M11 | Banner / logo accessibility | `images/sluice_banner.png`, `images/sluice-for-gold.jpg`, `images/sluice-logo.png` are committed (not gitignored) and resolve over npm's image proxy. | `git ls-files images/` and a smoke-test render via `npm view @caracal-lynx/sluice` |

---

## Step-by-step execution checklist (hand to Claude Code)

> Run these in order. Stop at any step that doesn't pass its verification.

1. **Verify prerequisites #1–#8** in the table above. If any fail, halt and escalate to Michael — do not proceed.
2. **Confirm `docs/elevator-pitch.md` exists.** If it doesn't, **stop and request the canonical pitch text from Michael** before any README edits.
3. **Edit the badge row** in `README.md` (lines ~7–9):
   - Remove `License: private` badge.
   - Add `License: Elastic-2.0` badge linking to `LICENCE-FAQ.md`.
   - Add `npm` version badge (`https://img.shields.io/npm/v/@caracal-lynx/sluice`).
   - Add `Docs` badge **only if** Phase 8 site is live; otherwise insert a `<!-- TODO: add Docs badge once Phase 8 ships -->` comment.
4. **Insert the elevator-pitch hero block** above "🤔 What is this thing?" — text sourced from `docs/elevator-pitch.md` (or placeholder per §"Elevator pitch handling").
5. **Insert the "🧩 Extension model" section** between "🧰 Tech Stack" and "🚀 Quick Start". Three-tier framing + table linking to [PLUGINS.md](../PLUGINS.md).
6. **Insert the minimal Quickstart YAML snippet** at the top of "🚀 Quick Start", above the existing CLI command list. Snippet must satisfy the constraints in §"Quickstart YAML snippet" and reference a real file in `examples/`.
7. **Append "🏢 Sluice + Caracal Lynx Professional Services"** at the end of the README (before the new Community section), copy verbatim from §"Paid services section" above.
8. **Append "🤝 Community", "🔐 Security", "⚖️ Licence", "🏷️ About"** sections in that order.
9. **Update `package.json`** fields per M5–M9 (description, keywords, homepage, bugs, repository).
10. **Run `npm pack --dry-run`** and visually inspect the bundled README preview for broken images or dangling links.
11. **Set GitHub repository About panel** per M1–M3 (description, website URL, topics). Use `gh repo edit` for description/homepage; use the GitHub web UI for topics.
12. **Confirm GitHub Sponsors is off** (M4) — no `.github/FUNDING.yml` file.
13. **Render the README** locally (`gh markdown-preview`, VS Code preview, or paste into a GitHub gist) and walk every link, anchor, and image.
14. **Walk the Quickstart end-to-end on a clean machine** (or fresh devcontainer): `npm install -g @caracal-lynx/sluice` → copy-paste the YAML snippet → `sluice check` → `sluice run`. Time it. If it takes > 10 minutes, the snippet or the README is wrong — fix and retry.
15. **Open a draft PR** with the changes, request review from a second pair of eyes (Carolyn, Andrew, or Duncan if available), get sign-off on the paid-services copy specifically.
16. **Merge** when reviewed.

---

## Verification / done criteria

A reviewer should be able to tick every box below before Phase 6 closes.

### From the master plan ([§10 Success Criteria](./SLUICE-IMPLEMENTATION-PLAN.md#10-phase-6--readme--marketing))

- [ ] README live in the public repo with elevator pitch
- [ ] Paid services section clearly signposted
- [ ] Logo image rendering correctly (on github.com **and** npmjs.com)
- [ ] Quickstart badge linking to docs site (or, until Phase 8 ships, a TODO marker is in place)

### Additions from this spec

- [ ] ELv2 licence badge live and linked to `LICENCE-FAQ.md`; old `License: private` badge removed
- [ ] All Community section links resolve (Issues, Discussions, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`)
- [ ] `npm pack --dry-run` README preview is clean (no broken images, no dangling relative links)
- [ ] GitHub repo About panel: description set, website URL set, topics set
- [ ] `package.json` `description` / `keywords` / `homepage` / `bugs` / `repository` fields all populated
- [ ] No `.github/FUNDING.yml` file (GitHub Sponsors deliberately disabled)
- [ ] Cold-start Quickstart walkthrough completes in under 10 minutes on a clean machine
- [ ] Paid-services table reviewed by Michael for legal/commercial fitness before merge

---

## Open questions / risks

| # | Item | Risk | Mitigation |
|---|---|---|---|
| Q1 | Quickstart `Docs` badge target | Phase 8 may not be live when Phase 6 runs — there's no docs site to link to | Insert `<!-- TODO -->` HTML comment instead of a broken badge; add the badge in a follow-up PR when Phase 8 ships |
| Q2 | Logo / banner asset paths on npmjs.com | npm uses a CDN image proxy that occasionally fails on relative paths | Verify M11 with `npm pack --dry-run` *and* a real publish to a scratch package name first if uncertain |
| Q3 | Paid-services copy not legally reviewed | Phase 0 covered open-sourcing decisions, not marketing copy. Risk of claiming services that aren't yet contractually deliverable (e.g. "Sluice MCP Server" before Phase 9 ships) | Get Michael to sign off on the table specifically before merge. Consider adding a "🚧 Coming soon" tag against MCP Server until Phase 9 is in beta |
| Q4 | Elevator-pitch ownership | `docs/elevator-pitch.md` doesn't exist yet; multiple downstream docs reference it | This spec lists the file as Prerequisite #7. Phase 6 cannot start until Michael authors it |
| Q5 | "Phase 6.5 — Launch Announcement" not yet specced | Phase 6 closes with the README live but no amplification (HN, Reddit, blog) | Out of scope for this doc; flagged here so it's tracked. A separate `PHASE-06.5-launch-announcement-spec.md` should be authored when Phase 6 nears completion |

---

## Document inventory updates required

When this spec is created, [SLUICE-IMPLEMENTATION-PLAN.md §16 Document Inventory](./SLUICE-IMPLEMENTATION-PLAN.md#16-document-inventory) should be updated to reference it (alongside the existing `PHASE-02`, `PHASE-04`, `PHASE-08`, `PHASE-09`, `PHASE-10` entries). Also update §10 of the master plan to point at this file as the Phase 6 reference, mirroring how the other phases link to their detail docs.

---

*Caracal Lynx Limited — SC826823 — Gretna, Scotland*
*"Clean data flows through."*
