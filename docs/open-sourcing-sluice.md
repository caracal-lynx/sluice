# Open-Sourcing Sluice — Analysis & Action Plan

> **Context:** Sluice (`@caracal-lynx/sluice`) is a YAML-controlled ETL pipeline CLI owned by Caracal Lynx Limited (SC826823). This document analyses the pros, cons, required steps, and legal considerations for making the core repository public and open-source.

---

## Advantages

**Community leverage.** An open-source core attracts contributors who'll add source/target adapters, DQ rules, and transform types you haven't needed yet — free R&D from the data engineering community.

**Credibility and marketing.** For a consultancy, a public GitHub repo with real clients (anonymised configs) is a stronger portfolio than a PDF. It signals technical depth to prospective clients evaluating you for ERP migration work.

**Ecosystem fit.** Your stack (TypeScript, Node, DuckDB, Zod, YAML-driven) is the sweet spot of the current data tooling community. You'd land on people's radars who are already using similar tech.

**Plugin/extension pull.** With Phase 2's three-tier plugin system, open-sourcing the core creates a genuine extension marketplace — others write and publish `sluice-adapter-*` npm packages, which makes Sluice more valuable without you writing the code.

**Commoditise the generic, sell the specialist.** The core engine (ETL orchestration, DQ, transforms) can be free. The *Cochran IFS adapter*, the *BlueCherry adapter*, and your domain expertise in ERP migrations? Those remain proprietary — or become the basis of paid consulting engagements.

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

## Recommended Path for Caracal Lynx

1. **Complete Phase 2** (plugin/extension system) before going public — the extension story is the key differentiator
2. **Restructure** the repo into `packages/core` (public) and private client adapters
3. **Legal audit** — review client contracts and run a dependency licence check
4. **Board minute** — document the decision with all directors
5. **Open-source under Apache 2.0** — permissive enough for adoption, professional enough for enterprise clients
6. **Publish** `@caracal-lynx/sluice` to npm and announce via GitHub

The "work" is mostly repo restructuring and a legal audit of client contracts — not a huge lift, but worth doing properly rather than rushing.
