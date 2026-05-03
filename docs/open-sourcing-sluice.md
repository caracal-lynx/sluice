# Open-Sourcing Sluice — Decision & Action Plan

> **Context:** Sluice (`@caracal-lynx/sluice`) is a YAML-controlled ETL pipeline CLI owned by Caracal Lynx Limited (SC826823). **Decision made (April 2026):** The core Sluice CLI will be open-sourced under the Elastic Licence 2.0. Country/region rule packages, application adapters, client-specific plugins, and the Sluice MCP Server remain private commercial offerings from Caracal Lynx.
>
> **Sequencing:** Technical upgrades (Node v24, TypeScript v6) and Phase 3 plugin system are complete. Phase 4a (Enrich framework) is in progress. The open-source restructure and public launch follow as Phase 5.
>
> See `SLUICE-IMPLEMENTATION-PLAN.md` for the full phased plan.

---

## Advantages

**Community leverage.** An open-source core attracts contributors who'll add source/target adapters, DQ rules, and transform types you haven't needed yet — free R&D from the data engineering community.

**Credibility and marketing.** For a consultancy, a public GitHub repo with real clients (anonymised configs) is a stronger portfolio than a PDF. It signals technical depth to prospective clients evaluating you for data migration work or AI data readiness projects.

**Ecosystem fit.** Your stack (TypeScript, Node, DuckDB, Zod, YAML-driven) is the sweet spot of the current data tooling community. You'd land on people's radars who are already using similar tech.

**Plugin/extension pull.** With Phase 2's three-tier plugin system, open-sourcing the core creates a genuine extension marketplace — others write and publish `sluice-adapter-*` npm packages, which makes Sluice more valuable without you writing the code.

**Commoditise the generic, sell the specialist.** The core engine (ETL orchestration, DQ, transforms) can be free. The *Cochran IFS adapter*, the *BlueCherry adapter*, your domain expertise in data migrations, and your AI Data Readiness Audit service? Those remain proprietary — or become the basis of paid consulting engagements. Organisations adopting AI tools are a new and distinct audience who need exactly what Sluice's DQ engine does, but have never heard of ETL. The open-source core gets them in the door; the audit service is what Caracal Lynx sells them.

---

## Disadvantages

**Competitive exposure.** Your competitors (or a Cochran/Eribé's internal teams) could read exactly how your pipeline works and replicate it. The moat isn't deep if the code is the whole product.

**Client data risk.** Right now your YAML pipeline configs probably contain schema details, field names, and possibly connection strings that are commercially sensitive. You'd need to rigorously separate the engine from client configs before publishing.

**Maintenance overhead.** Open source brings issues, PRs, and users who expect support. For a two-person consultancy, that's a real time cost.

**Governance.** Carolyn, Andrew, and Duncan are directors. A decision to open-source IP owned by the company is a board-level decision — not just yours to make unilaterally, even as lead director.

**Phase 2 timing.** Opening the core *before* the plugin system exists means you're publishing an architecture that can't yet be extended. Better to open-source once Phase 2 is in place — otherwise the extension story is "wait for v2."

---

## What You'd Actually Have to Do

### 1. Choose a Licence

This is the biggest decision. The main options for a commercial consultancy:

| Licence | Summary | Best for |
|---------|---------|----------|
| **MIT / Apache 2.0** | Maximally permissive. Anyone can use, fork, and sell it. | Maximum adoption |
| **AGPL-3.0** | Copyleft: anyone who modifies and distributes must open-source their changes. | Deterring proprietary forks |
| **Business Source Licence (BUSL)** | "Source available but not truly open." Converts to open source after N years. | Controlled publication (legally grey) |
| **Dual licence** | Free under AGPL for open-source users; commercial licence for proprietary embedding. | Classic MySQL/MongoDB model |

**Recommended:** MIT or Apache 2.0 for the core engine + proprietary client adapters.

### 2. Audit the Codebase Before Publishing

Scrub the following before any public commit:

- Hardcoded connection strings or credentials
- Client-identifiable schema names or field names
- Real company names in comments or test fixtures
- Anything covered by client confidentiality agreements (review Cochran Group and Eribé Knitwear contracts specifically)

### 3. Restructure the Repository

Separate the public engine from private client configs and adapters. A monorepo structure works well:

```
packages/
  core/          ← public (open-source engine)
  adapters/
    ifs/         ← private (Cochran Group)
    bluecherry/  ← private (Eribé Knitwear)
    bc/          ← publishable (Business Central OData)
    csv/         ← publishable (generic)
    pg/          ← publishable (generic)
clients/
  cochran/       ← private (YAML configs, never published)
  eribe/         ← private (YAML configs, never published)
```

> The Phase 2 plugin architecture is already designed for exactly this separation — good timing.

### 4. Add Open-Source Hygiene Files

- `LICENSE` — the chosen licence text
- `CONTRIBUTING.md` — how to submit PRs and issues
- `CODE_OF_CONDUCT.md` — community standards
- `SECURITY.md` — vulnerability disclosure process
- `README.md` — clear description that does not expose your client list

### 5. Publish to npm

`@caracal-lynx/sluice` as a scoped public package. Decide whether adapters are bundled or separately published (e.g. `@caracal-lynx/sluice-adapter-csv`).

---

## Legal Issues to Address

### Scottish Company Law

As a Scottish company (Companies House SC826823), any decision to assign or licence company IP externally should ideally be **minuted as a board resolution**. Not legally required for ordinary licensing decisions, but given it's a family company with multiple directors (Michael, Carolyn, Andrew, Duncan), documenting the decision protects everyone.

### Client Contracts

Read your engagement agreements with **Cochran Group** and **Eribé Knitwear** carefully. Many consulting contracts include:

- Clauses asserting that IP *created for the client* belongs to the client
- Confidentiality obligations covering data, schema details, and business logic

If Sluice was built partly using their data as test cases or their requirements shaped the architecture, this could be relevant to what you can publish.

### UK GDPR

If any test data, sample CSVs, or fixture files contain real customer records (even anonymised), that's a UK GDPR issue before publication. Scotland is subject to UK GDPR post-Brexit.

### Dependency Licences

Your stack is mostly MIT/Apache. DuckDB is MIT. Run a licence audit before choosing your own licence:

```bash
npx license-checker --summary
# or
npx licensee
```

A couple of packages might carry GPL obligations that affect your licence choice.

### npm Namespace

Confirm that `@caracal-lynx` is registered to you on [npmjs.com](https://www.npmjs.com) before any public announcement.

---

## Confirmed Decision for Caracal Lynx

### Licence: Elastic Licence 2.0 (ELv2) ✅ Decided

ELv2 is one page, plain English, and its core restriction maps exactly to the intent: businesses can use Sluice freely for their own migrations; other consultancies cannot resell it as a service without a commercial licence from Caracal Lynx. See `licensing-strategy.md` and `LICENCE-FAQ.md` for full detail.

### What is open-source vs private

| Component | Status | Rationale |
|-----------|--------|-----------|
| Core CLI engine | 🌍 **Public (ELv2)** | Community credibility, ecosystem growth |
| Country/region rule packages (etl-rules-uk, etl-rules-fashion) | 🔒 **Private (paid)** | Domain expertise — Caracal Lynx service value |
| Application adapters (IFS, BC, BlueCherry) | 🔒 **Private (paid)** | ERP-specific knowledge |
| Client-specific plugins | 🔒 **Private (paid)** | Bespoke per-engagement deliverables |
| Sluice MCP Server | 🔒 **Private (paid)** | Premium AI-assisted migration service |
| AI Data Readiness Audit | 🔒 **Private (paid service)** | Caracal Lynx-delivered audit: connect, profile, report, recommend |

### Repository restructure

The current monorepo must be split before the public launch:

```
PUBLIC: caracal-lynx/sluice (GitHub public)
  packages/core/              ← open-source CLI engine only

PRIVATE: caracal-lynx/sluice-rules (GitHub private)
  packages/etl-rules-uk/      ← private paid service
  packages/etl-rules-fashion/ ← private paid service
```

Application adapter repos and client repos remain as private standalone repos.

### Agreed implementation sequence

1. **Phase 0** (now): Board resolution, legal audit of client contracts, GDPR audit, dependency licence check
2. ✅ **Phase 1 (COMPLETE)**: Node v24 + DuckDB Neo upgrade
3. ✅ **Phase 2 (COMPLETE)**: TypeScript v6 upgrade
4. ✅ **Phase 3 (COMPLETE)**: Plugin system (three-tier extension model)
5. 🔵 **Phase 4a (IN PROGRESS)**: Enrich framework — private `caracal-lynx/sluice-enrich`
6. 🔴 **Phase 5 (blocked by Phase 4a)**: Repo restructure and open-source launch — make `caracal-lynx/sluice` public, split `etl-rules-*` to private `sluice-rules` repo
7. See `SLUICE-IMPLEMENTATION-PLAN.md` for the full sequence (Phases 0–11)

See `SLUICE-IMPLEMENTATION-PLAN.md` for full detail on every phase.
