# Sluice — Phase 5: Repo Restructure & Open-Source Launch (Spec)

> 🔴 **Status: BLOCKED by Phase 4a + Phase 0.** This document specifies how Phase 5 will be executed once the private `caracal-lynx/sluice-enrich` repo exists (Phase 4a) and the Phase 0 governance audits are confirmed clean. Do **not** start Phase 5 work until both gates are green — the post-launch topology assumes `sluice-enrich` is already a separate private repo, and the public flip is irreversible without legal cover.
>
> **Owner:** Caracal Lynx Limited · Michael Scott
> **Estimated effort:** 2–3 weeks
> **Master plan reference:** [SLUICE-IMPLEMENTATION-PLAN.md §9](./SLUICE-IMPLEMENTATION-PLAN.md#9-phase-5--repo-restructure--open-source-launch)

---

## Context

Today the entire Sluice ecosystem lives inside one private GitHub repository (`caracal-lynx/sluice`). Phase 5 turns that repository public under the **Elastic Licence 2.0** while moving everything that must remain commercial — domain rule packages, ERP adapters, the enrichment service, the MCP server, and per-client engagement code — into separate private repositories under the same `caracal-lynx` organisation.

The strategic intent is the "commoditise the platform, sell the expertise" model captured in [SLUICE-IMPLEMENTATION-PLAN.md §1](./SLUICE-IMPLEMENTATION-PLAN.md#1-the-vision): the engine becomes a free, auditable, community-credible asset; the consultancy keeps everything that represents accumulated client knowledge and bespoke delivery as paid services. Phase 5 is the irreversible flip that makes that split real.

Phase 5 is **not** a monorepo-split. The current repo is already a flat single-package layout (no `packages/` directory). The work is mostly in-place open-sourcing of `caracal-lynx/sluice` plus the _creation_ of new sibling private repos — a smaller, lower-risk migration than the master plan's "before / after" diagram (which carries an aspirational pre-state) might suggest.

---

## Goals & non-goals

### Goals

- The public repository at `github.com/caracal-lynx/sluice` is live, discoverable, and licensed under ELv2.
- Every source file in the public repo carries an SPDX `Elastic-2.0` header.
- All open-source hygiene files (`LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `LICENCE-FAQ.md`, issue/PR templates) are committed at the repo root.
- The `@caracal-lynx/sluice` package is published as a public npm package; the npm scope is configured for further private packages.
- Seven sibling private repos exist in their post-launch shape: `sluice-enrich` (already created in Phase 4a), `sluice-rules`, `sluice-adapter-{ifs,bc,bluecherry}`, `sluice-mcp`, and per-client repos for Acme Corp and Style Co.
- `clients/` is no longer present in the public repo's working tree or any reachable git history.

### Non-goals (explicitly deferred)

- **Release automation, Changesets, Renovate, GitHub Actions release workflows** → owned by [Phase 7](./PHASE-07-git-npm-workflow-spec.md). Phase 5 sets up scopes and tokens; Phase 7 wires up the cascade.
- **README hero copy, paid-services section, marketing artefacts** → owned by [Phase 6](./PHASE-06-readme-and-marketing-spec.md). Phase 5 leaves a placeholder README that meets the licensing-and-pointer minimum so the repo isn't bare on day one.
- **Documentation site (Astro/Starlight)** → owned by [Phase 8](./SLUICE-IMPLEMENTATION-PLAN.md#12-phase-8--github-pages-documentation-site). Phase 5 enables GitHub Pages on the public repo but doesn't author the site.
- **Enrich service implementation** → owned by [Phase 4](./PHASE-04-enrich-phase.md). Phase 5 assumes `sluice-enrich` already exists as a private repo.
- **MCP server implementation** → owned by [Phase 9](./PHASE-09-sluice-mcp-spec.md). Phase 5 only creates the empty `sluice-mcp` repo as part of the topology.
- **Branching strategy & PR conventions** → moved to [`branching-strategy.md`](./branching-strategy.md). Not a Phase 5 deliverable.

---

## Prerequisites (must be true before starting)

| #   | Prerequisite                                                               | Owned by   | Verify with                                                 |
| --- | -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| 1   | Phase 0 board resolution minuted; ELv2 decision recorded                   | Phase 0    | Caracal Lynx board minutes                                  |
| 2   | Phase 0 client contract audit clean (no IP / confidentiality blockers)     | Phase 0    | Legal review record                                         |
| 3   | Phase 0 GDPR audit clean across HEAD **and history**                       | Phase 0    | `git log -S "acme-corp"` etc. — see §2.1 below              |
| 4   | Phase 0 dependency licence audit clean (MIT / Apache 2.0 / BSD / ISC only) | Phase 0    | `npx license-checker --summary --excludePrivatePackages`    |
| 5   | npm `@caracal-lynx` org confirmed, Pro plan active                         | Phase 0    | `npm whoami && npm access list packages @caracal-lynx`      |
| 6   | Phase 4a complete — `caracal-lynx/sluice-enrich` exists as a private repo  | Phase 4a   | `gh repo view caracal-lynx/sluice-enrich --json visibility` |
| 7   | All Vitest suites green on master                                          | continuous | `npm test`                                                  |
| 8   | Working tree clean; no uncommitted changes                                 | continuous | `git status`                                                |

If any row is not green, do not start Phase 5.

---

## §1 — Topology: before & after

```mermaid
graph LR
    subgraph BEFORE["TODAY · single private repo"]
        SLUICE_OLD["caracal-lynx/sluice (private)<br/>src/ · tests/ · docs/<br/>clients/acme-corp · clients/style-co"]
    end

    subgraph AFTER["AFTER PHASE 5"]
        direction TB
        subgraph PUB["🌍 Public · ELv2"]
            SLUICE_NEW["caracal-lynx/sluice<br/>(same flat layout, now public)<br/>+ LICENSE · CONTRIBUTING · etc."]
        end
        subgraph PRIV["🔒 Private siblings"]
            ENRICH["sluice-enrich<br/>(from Phase 4a)"]
            RULES["sluice-rules<br/>(monorepo: etl-rules-uk, etl-rules-fashion)"]
            IFS["sluice-adapter-ifs"]
            BC["sluice-adapter-bc"]
            BLUE["sluice-adapter-bluecherry"]
            MCP["sluice-mcp<br/>(empty skeleton; impl is Phase 9)"]
            ACME_CORP["sluice-client-acme-corp"]
            STYLE_CO["sluice-client-style-co"]
        end
    end

    SLUICE_OLD -->|in-place flip| SLUICE_NEW
    SLUICE_OLD -.->|extract clients/| ACME_CORP
    SLUICE_OLD -.->|extract clients/| STYLE_CO

    style SLUICE_OLD fill:#e2e3e5,stroke:#6c757d
    style SLUICE_NEW fill:#d4edda,stroke:#28a745
    style ENRICH fill:#f8d7da,stroke:#dc3545
    style RULES fill:#f8d7da,stroke:#dc3545
    style IFS fill:#f8d7da,stroke:#dc3545
    style BC fill:#f8d7da,stroke:#dc3545
    style BLUE fill:#f8d7da,stroke:#dc3545
    style MCP fill:#f8d7da,stroke:#dc3545
    style ACME_CORP fill:#f8d7da,stroke:#dc3545
    style STYLE_CO fill:#f8d7da,stroke:#dc3545
```

Two things are worth calling out about this diagram:

1. **The public repo's internal layout doesn't change.** `src/`, `tests/`, `docs/`, `examples/` stay where they are. Phase 5 adds files (LICENSE, hygiene files, SPDX headers) and removes the `clients/` directory; it does not introduce a `packages/` split.
2. **`sluice-rules` is a private monorepo of its own**, not a folder inside the public repo. The earlier draft of this document (and the master plan's pre-Phase-5 "before" diagram) showed `etl-rules-uk` and `etl-rules-fashion` as `packages/*` inside the public sluice repo. That was always wrong for the open-source split: domain rules are paid services and must live in a private repo. Putting them inside the public repo would have either licensed away paid IP or created an awkward `.npmignore` mess.

---

## §2 — Repository restructure execution

The Phase 5 work happens in a controlled sequence on a single working day. Each step is gated on the previous one passing.

### 2.1 — GDPR / secrets history audit

Run the audit listed in [SLUICE-IMPLEMENTATION-PLAN.md §4.3](./SLUICE-IMPLEMENTATION-PLAN.md#43-uk-gdpr-audit) against the **full git history**, not just HEAD:

```bash
# Client identifiers (real client names should not appear anywhere in the public repo)
git log --all -S "acme-corp" --pretty=oneline
git log --all -S "style-co"   --pretty=oneline
git log --all -S "Style Co"   --pretty=oneline

# Credential patterns
git log --all -S "password=" --pretty=oneline
git log --all -S "Bearer "   --pretty=oneline
git log --all -S "BEGIN PRIVATE KEY" --pretty=oneline
git log --all -S "BEGIN RSA PRIVATE KEY" --pretty=oneline

# Connection strings
git log --all -S "mssql://" --pretty=oneline
git log --all -S "postgres://" --pretty=oneline

# Internal hostnames (substitute for the actual ones the consultancy uses)
git log --all -S "legacy.example.local"  --pretty=oneline
git log --all -S "legacy2.example.local"    --pretty=oneline
```

Expected: every command returns no rows. If any row appears, **do not flip public** — investigate, decide whether to rewrite history (BFG / `git filter-repo`) or to leave as private and re-evaluate. A single overlooked credential is a flip-blocker.

### 2.2 — Move client folders out

Before the flip, the existing `clients/acme-corp/` and `clients/style-co/` folders need to be in their new private repos (`sluice-client-acme-corp`, `sluice-client-style-co`). The clean way is to extract with history preserved:

```bash
# From a fresh clone of the current repo
git clone https://github.com/caracal-lynx/sluice.git sluice-client-acme-corp
cd sluice-client-acme-corp
git filter-repo --path clients/acme-corp --path-rename clients/acme-corp/:
# Push to the new private repo
git remote remove origin
git remote add origin https://github.com/caracal-lynx/sluice-client-acme-corp.git
git push -u origin master
```

Repeat for Style Co. Then in the original repo, delete the `clients/` directory and commit:

```bash
git rm -r clients/
git commit -m "[master] - chore: remove clients/ from public repo (now in client-specific private repos)"
```

The deletion does **not** by itself remove client data from history. That's why §2.1's history audit is a prerequisite — if it's clean, the recipe-only YAML configs that lived in `clients/` are not a confidentiality concern (they're not real data, they describe migration mappings). If §2.1 surfaced anything sensitive, it must be removed via a history rewrite _before_ the flip.

### 2.3 — Final HEAD scrub

With `clients/` gone, do one more pass over HEAD for stale identifiers:

```bash
# In the working tree, not history
grep -ri --include="*.ts" --include="*.md" --include="*.yaml" --include="*.yml" \
  -e "acme-corp" -e "style-co" -e "Style Co" \
  src/ tests/ docs/ examples/ README.md
```

Some hits are legitimate (this very file, the master plan, CLAUDE.md mention the clients by name as documented case studies — that's allowed by the Phase 0 client-contract audit). Hits in `src/` or `tests/fixtures/*.yaml` are not allowed. Replace with generic placeholders (`acme-corp`, `style-co`) and commit.

### 2.4 — Git history strategy

Decision: **preserve history**. Phase 0.3 + §2.1 + §2.3 are the gates. If they pass, the public repo ships with full history including PR numbers, attributions, and the entire Phase 1 / Phase 3 implementation arc. This is the cheaper option and gives the open-source repo more credibility (visible engineering history, not a single squash commit).

The fresh-start alternative (squash to a single commit before flipping) is only needed if §2.1 surfaces something that can't be cleaned up. Document the choice in the board minutes for completeness.

---

## §3 — Open-source hygiene files

Author and commit these at the repo root before flipping public.

| File                                         | Source / template                                                                                                | Acceptance criterion                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `LICENSE`                                    | Verbatim ELv2 text from [elastic.co/licensing/elastic-license](https://www.elastic.co/licensing/elastic-license) | First line: `Elastic License 2.0`; last line includes `Limitations`                                           |
| `LICENCE-FAQ.md`                             | Already authored; verify it's current                                                                            | Mentions `@caracal-lynx/sluice` by name and gives the plain-English "may I…?" answers                         |
| `CONTRIBUTING.md`                            | New — author per template below                                                                                  | Covers PR process, conventional commits convention, DCO sign-off requirement, link to `branching-strategy.md` |
| `CODE_OF_CONDUCT.md`                         | [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) verbatim          | Reporting email is `conduct@caracallynx.com`                                                                  |
| `SECURITY.md`                                | New — author per template below                                                                                  | Reporting channel: `security@caracallynx.com`; SLA: 48-hour acknowledgement, 90-day disclosure                |
| `.github/ISSUE_TEMPLATE/bug_report.yml`      | GitHub form schema                                                                                               | Captures: Sluice version, Node version, OS, pipeline YAML excerpt, expected vs actual                         |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | GitHub form schema                                                                                               | Captures: use case, proposed YAML / API shape, willingness to PR                                              |
| `.github/ISSUE_TEMPLATE/config.yml`          | Routing config                                                                                                   | Disables blank issues; routes commercial enquiries to `sluice@caracallynx.com`                                |
| `.github/PULL_REQUEST_TEMPLATE.md`           | New — short checklist                                                                                            | Covers: tests added, CHANGELOG updated, breaks public API?                                                    |

`CONTRIBUTING.md` skeleton:

```markdown
# Contributing to Sluice

Thanks for considering a contribution. Sluice is open-source under the Elastic
Licence 2.0; bug reports, feature requests, and PRs are all welcome under that
licence's terms.

## Reporting bugs

Use the bug report issue template. Include the smallest pipeline YAML that
reproduces the issue.

## Submitting a PR

1. Fork the repo and create a feature branch from `master`. Branch naming
   conventions are documented in [branching-strategy.md](./docs/branching-strategy.md).
2. Add tests for any new behaviour. Sluice maintains 80% line coverage in
   `src/dq/` and `src/transform/` — see [CLAUDE.md](./CLAUDE.md).
3. Run `npm test` and `npm run lint` locally before opening the PR.
4. Add a `.changeset/` entry describing the change (see Phase 7 docs).
5. Sign off your commits: `git commit -s -m "..."`.

## Commercial questions

For paid services (enrichment, ERP adapters, domain rule packages, MCP server,
or migration delivery) email sluice@caracallynx.com — these are not
handled via GitHub issues.
```

`SECURITY.md` skeleton:

```markdown
# Security Policy

## Reporting a vulnerability

Email security@caracallynx.com with details. Please do not open a public issue
for security reports.

We aim to acknowledge within 48 hours and to publish a fix within 90 days.

## Supported versions

The current major version of `@caracal-lynx/sluice` receives security fixes.
Older majors do not.
```

---

## §4 — ELv2 licence header application

Every TypeScript file in `src/` must carry the SPDX header:

```typescript
// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited
```

Application script (one-off, idempotent — safe to re-run):

```bash
HEADER=$'// SPDX-License-Identifier: Elastic-2.0\n// Copyright (c) 2026 Caracal Lynx Limited\n\n'
find src -name "*.ts" -type f | while read -r f; do
  if ! grep -q "SPDX-License-Identifier: Elastic-2.0" "$f"; then
    printf '%s' "$HEADER" | cat - "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done
```

Verification:

```bash
# Should print nothing — every src/*.ts has the header
find src -name "*.ts" -type f -exec grep -L "SPDX-License-Identifier: Elastic-2.0" {} \;
```

`package.json` change:

```json
{
  "license": "Elastic-2.0"
}
```

`tests/` and `examples/` do **not** need the header — they are illustrative, not part of the licensed product. `docs/` is markdown and is governed by the repo-level `LICENSE` file.

---

## §5 — npm publishing setup

Phase 5 only sets up the _access_. The publish _workflow_ (Changesets bot, GitHub Actions, automated tagging) is wired up in Phase 7.

### 5.1 — Public package configuration

Add to the root `package.json`:

```json
{
  "name": "@caracal-lynx/sluice",
  "license": "Elastic-2.0",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/caracal-lynx/sluice.git"
  },
  "homepage": "https://github.com/caracal-lynx/sluice#readme",
  "bugs": {
    "url": "https://github.com/caracal-lynx/sluice/issues"
  }
}
```

### 5.2 — npm token (org-level automation token)

```bash
# Generate at npmjs.com → Access Tokens → Granular → Automation
#  - Scope: @caracal-lynx
#  - Permissions: Read and write
#  - Expiry: 12 months (renewal calendared)

# Store as a GitHub Actions org-level secret named NPM_TOKEN
gh secret set NPM_TOKEN --org caracal-lynx --body "npm_xxxxxxxx" \
  --visibility selected --repos sluice
# (extend --repos in Phase 7 to include adapter and rules repos)
```

### 5.3 — First manual publish (smoke test)

Phase 5 does **one** manual publish to confirm the pipeline works end-to-end. Subsequent releases are automated by Phase 7.

```bash
npm whoami                              # confirm logged in as caracal-lynx
npm run build && npm test               # green
npm publish --access public --dry-run   # inspect tarball contents
npm publish --access public             # the real publish
npm view @caracal-lynx/sluice version   # confirm registry resolves
```

**See [PHASE-07-git-npm-workflow-spec.md](./PHASE-07-git-npm-workflow-spec.md)** for everything beyond this first publish: Changesets configuration, the `release.yml` GitHub Actions workflow, npm provenance attestations, and Renovate cascade across the private repos.

---

## §6 — Make the GitHub repository public

This is the irreversible step. Only proceed once every preceding section is done.

### 6.1 — Pre-flight checklist (every box must be ✅)

- [ ] §2.1 GDPR / secrets history audit returned zero hits
- [ ] §2.2 `clients/` folders extracted to private repos and verified runnable there
- [ ] §2.3 final HEAD scrub clean
- [ ] §3 hygiene files all committed at repo root and rendering correctly on github.com (preview via the GitHub web UI on the private repo)
- [ ] §4 ELv2 SPDX header on every `src/*.ts` file (verification grep returns nothing)
- [ ] §5 `package.json` has `"license": "Elastic-2.0"` and the public publish smoke-test succeeded
- [ ] All tests green on master
- [ ] Phase 0 governance sign-off recorded

### 6.2 — Flip the visibility

GitHub web UI:

1. **Settings → General → Danger Zone → Change repository visibility → Make public.**
2. Confirm by typing the repo name.
3. The repo is now public. URL is unchanged: `github.com/caracal-lynx/sluice`.

### 6.3 — Post-flip configuration

Done immediately after the flip, in the same window:

| Setting                               | Value                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages                                 | Source: `master` branch · `/docs` folder (placeholder until Phase 8 fills the site). Custom domain: `sluice.caracallynx.com` if/when DNS ready. |
| Discussions                           | Enable (community Q&A channel)                                                                                                                  |
| Topics                                | `etl`, `data-migration`, `erp`, `typescript`, `yaml`, `duckdb`, `cli`, `data-quality`, `pipeline`                                               |
| Default branch protection on `master` | Require PR before merge · Require 1 approval · Require CI to pass · Restrict force-push                                                         |
| Issue labels                          | Add `area/dq`, `area/transform`, `area/adapter-source`, `area/adapter-target`, `area/staging`, `good-first-issue`, `help-wanted`                |
| About panel (sidebar)                 | Description copy lifted from [PHASE-06](./PHASE-06-readme-and-marketing-spec.md); website link to docs (Phase 8)                                |
| Sponsorship                           | Off — paid services are pitched in the README, not via GitHub Sponsors                                                                          |

The README copy itself is Phase 6's deliverable; Phase 5 leaves the existing internal README in place as a placeholder. The visible defects (a `License: private` badge, no commercial-services section) are acceptable for the few weeks between Phase 5 and Phase 6.

---

## §7 — Sibling private repos

Each private repo follows the same skeleton. Phase 5 creates them empty (or near-empty) so the topology is in place; the actual implementations are owned by their respective phases.

### 7.1 — `sluice-rules` (private monorepo)

Already specified in [SLUICE-IMPLEMENTATION-PLAN.md §9.1](./SLUICE-IMPLEMENTATION-PLAN.md#9-phase-5--repo-restructure--open-source-launch). Repository contains two npm packages: `@caracal-lynx/etl-rules-uk` and `@caracal-lynx/etl-rules-fashion`. Layout:

```
sluice-rules/
├── packages/
│   ├── etl-rules-uk/
│   │   ├── src/index.ts
│   │   ├── package.json     # peer dep on @caracal-lynx/sluice
│   │   └── tsconfig.json
│   └── etl-rules-fashion/
│       └── (mirror layout)
├── package.json             # workspaces: ["packages/*"]
├── tsconfig.base.json
└── .github/workflows/ci.yml
```

Empty packages on first commit are fine — the rules themselves are existing internal IP that gets ported in over time.

### 7.2 — Adapter repos (`sluice-adapter-{ifs,bc,bluecherry}`)

Three repos, identical skeleton, one per ERP. Each declares `@caracal-lynx/sluice` as a peer dependency:

```
sluice-adapter-ifs/
├── src/
│   ├── adapter.ts           # extracted from current src/adapters/target/ifs.ts
│   └── transforms/          # extracted from current src/transform/* if IFS-specific
├── tests/
├── package.json             # peer dep on @caracal-lynx/sluice
├── tsconfig.json
└── .github/workflows/ci.yml
```

The current `src/adapters/target/{bc,ifs,bluecherry}.ts` files **stay in the public repo** until the adapter repos are populated and the Phase 7 cascade is wired up. The clean removal happens in a later phase, not Phase 5. Phase 5 just creates the empty target repos so they exist in the topology.

### 7.3 — `sluice-mcp`

Created empty in Phase 5; populated by [Phase 9](./PHASE-09-sluice-mcp-spec.md). Skeleton: `package.json`, `tsconfig.json`, `README.md` pointing at the spec doc, that's it.

### 7.4 — Client repos (`sluice-client-{acme-corp,style-co}`)

Already populated by §2.2's `git filter-repo` extraction. Phase 5 just adds the standard skeleton on top:

```
sluice-client-acme-corp/
├── pipelines/               # the YAML configs from clients/acme-corp/
├── lookups/                 # CSV lookup tables
├── plugins/                 # any client-bespoke plugins (Tier-2)
├── .env.example             # template — real .env is gitignored
├── .npmrc                   # ${NPM_TOKEN} for @caracal-lynx scope
├── package.json             # depends on @caracal-lynx/sluice + relevant adapters + relevant rules
├── README.md                # how to run; what's in scope; emergency contacts
└── .github/workflows/ci.yml # tsc · lint · sluice check --all (no live runs in CI)
```

Renovate config for these repos is a Phase 7 deliverable, not here.

### 7.5 — npm scope registration for all private repos

Each private repo's `.npmrc` (committed):

```
@caracal-lynx:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

The first `npm publish` from each private repo is manual (Phase 5 smoke test); automation is Phase 7.

---

## §8 — Verification & success criteria

Manual + automated checks that prove Phase 5 is done. Run all of these after the flip.

### 8.1 — Public repo proofs

```bash
# Repo is public
gh repo view caracal-lynx/sluice --json visibility -q .visibility    # → "PUBLIC"

# Licence is set in package.json
jq -r .license package.json                                          # → "Elastic-2.0"

# SPDX header on every source file
find src -name "*.ts" -exec grep -L "SPDX-License-Identifier: Elastic-2.0" {} \; | wc -l
                                                                     # → 0

# Hygiene files present
ls LICENSE LICENCE-FAQ.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md \
   .github/ISSUE_TEMPLATE/bug_report.yml \
   .github/ISSUE_TEMPLATE/feature_request.yml \
   .github/PULL_REQUEST_TEMPLATE.md                                  # → all listed

# npm publish succeeded
npm view @caracal-lynx/sluice version                                # → resolves to a version

# clients/ is gone from HEAD
ls clients/ 2>&1 | grep -q "No such"                                 # → exit 0
```

### 8.2 — Private repo proofs

```bash
gh repo list caracal-lynx --json name,visibility \
  | jq '.[] | select(.name | startswith("sluice-")) | "\(.visibility)  \(.name)"'
# Expected output (order may vary):
# PUBLIC   sluice
# PRIVATE  sluice-enrich
# PRIVATE  sluice-rules
# PRIVATE  sluice-adapter-ifs
# PRIVATE  sluice-adapter-bc
# PRIVATE  sluice-adapter-bluecherry
# PRIVATE  sluice-mcp
# PRIVATE  sluice-client-acme-corp
# PRIVATE  sluice-client-style-co
```

### 8.3 — Manual / human checks

- LICENCE-FAQ.md renders with correct headings and links on `github.com/caracal-lynx/sluice`.
- The default Issues view shows the bug-report and feature-request templates.
- Discussions tab is enabled and visible on the public repo.
- Repo About panel has a description, topics, and (eventually) a website link.
- Searching `etl typescript yaml` on github.com/search returns the public repo within the first page within 7 days.

### 8.4 — Master plan checkbox alignment

- [SLUICE-IMPLEMENTATION-PLAN.md §9 success criteria](./SLUICE-IMPLEMENTATION-PLAN.md#9-phase-5--repo-restructure--open-source-launch) — all six checkboxes flip from `- [ ]` to `- [x]`.

---

## §9 — Rollback plan

The flip is essentially one-way, but partial rollbacks are possible.

### 9.1 — Reverting visibility

GitHub Settings → General → Danger Zone → Change repository visibility → Private. Instant. **Caveat:** anyone who cloned during the public window keeps their clone; anyone who forked keeps their fork (until manually deleted by them). The repo's existence and metadata may already be cached by github.com search, by web archives, and by various npm mirrors.

### 9.2 — Reverting the npm publish

`npm unpublish @caracal-lynx/sluice@<version>` is allowed within 72 hours of publish, with caveats:

- Doesn't remove cached tarballs from npm mirrors (unpkg, jsdelivr, etc.)
- Doesn't invalidate clones already done by `npm install`
- After the 72-hour window: `npm deprecate @caracal-lynx/sluice "deprecated"` is the only option, which leaves the version on the registry but warns on install

### 9.3 — Licence consequences

The ELv2 grant is **irrevocable for any version published**. Even if the repo and npm package are pulled, the version that was public remains usable under ELv2 by anyone who downloaded it. This is by design — ELv2 is not a rug-pull license.

### 9.4 — When rollback is the right call

Only if §6.1's pre-flight checklist had a false negative — i.e. something sensitive slipped through that wasn't caught by the audits. In that case: revert visibility, do the cleanup with `git filter-repo`, redo the audits, and re-flip when clean.

For "we changed our minds about open-sourcing" — there is no rollback. ELv2 versions stay out.

---

## §10 — Out-of-scope cross-references

Anything not covered in §§1–9 belongs to a sibling phase doc. This section exists so future readers don't grep this file looking for what's not here.

| Topic                                                                                         | Owning doc                                                                              |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Branching strategy, PR conventions, hotfix flow                                               | [`docs/branching-strategy.md`](./branching-strategy.md)                                 |
| Changesets, GitHub Actions release workflow, Renovate cascade, breaking-change policy         | [`docs/PHASE-07-git-npm-workflow-spec.md`](./PHASE-07-git-npm-workflow-spec.md)         |
| README hero, paid-services section, marketing artefacts (logo, social card, About panel copy) | [`docs/PHASE-06-readme-and-marketing-spec.md`](./PHASE-06-readme-and-marketing-spec.md) |
| GitHub Pages docs site (Astro / Starlight)                                                    | [`docs/PHASE-08-github-pages-plan.md`](./PHASE-08-github-pages-plan.md)                 |
| Enrich service architecture & providers                                                       | [`docs/PHASE-04-enrich-phase.md`](./PHASE-04-enrich-phase.md)                           |
| MCP server tools and implementation                                                           | [`docs/PHASE-09-sluice-mcp-spec.md`](./PHASE-09-sluice-mcp-spec.md)                     |
| Node 24 + DuckDB Neo upgrade (already shipped)                                                | [`docs/archive/node24-upgrade-plan.md`](./archive/node24-upgrade-plan.md)               |
| TypeScript v6 upgrade (Phase 2)                                                               | [`docs/PHASE-02-typescript-v6-upgrade.md`](./PHASE-02-typescript-v6-upgrade.md)         |
| TypeScript v7 / tsgo migration (Phase 11)                                                     | [`docs/PHASE-11-typescript-v7-spec.md`](./PHASE-11-typescript-v7-spec.md)               |

---

## §11 — Client local setup

This section is the canonical reference for getting a client engagement running on a fresh laptop. It is referenced by [SLUICE-IMPLEMENTATION-PLAN.md §13 (Phase 9 success criteria)](./SLUICE-IMPLEMENTATION-PLAN.md#13-phase-9--sluice-mcp-server-private-paid-service) and survives the Phase 5 rewrite for that reason.

### 11.1 — Prerequisites

| Tool                                             | Required version          | Notes                                                                                                  |
| ------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Node.js                                          | 24 LTS or later           | Phase 1 raised the floor from Node 20 to Node 24. The `engines` field in `package.json` enforces this. |
| npm                                              | 10.x (ships with Node 24) | No separate install.                                                                                   |
| Git                                              | Any recent                | 2.30+ for `--filter` support if the client ever needs `filter-repo`.                                   |
| PowerShell 7 (Windows) or zsh/bash (macOS/Linux) | Any                       | Sluice runs on all three; Caracal Lynx develops on Windows / PowerShell 7.                             |

Verification:

```bash
node --version    # v24.x.x or higher
npm --version     # 10.x.x or higher
git --version     # 2.30+
```

### 11.2 — npm authentication for private packages

The public `@caracal-lynx/sluice` package needs no authentication. The private packages (rule packages, adapters, enrichment, MCP) require an `NPM_TOKEN` provisioned by Caracal Lynx.

**Caracal Lynx provisions the token (one-off per client engagement):**

1. Sign in to npmjs.com as the `caracal-lynx` org owner.
2. Access Tokens → Granular Access Token → read-only, scoped to `@caracal-lynx`, expiry 12 months.
3. Send to the client over a 1Password secure share or equivalent — never email.

**Client configures the token (one-off per machine):**

```powershell
# Windows / PowerShell — persists across sessions for the user
[System.Environment]::SetEnvironmentVariable("NPM_TOKEN", "npm_xxxxxxxx", "User")
```

```bash
# macOS / Linux — add to ~/.zshrc or ~/.bashrc
echo 'export NPM_TOKEN=npm_xxxxxxxx' >> ~/.zshrc
source ~/.zshrc
```

The client repo's `.npmrc` file (committed to the repo) reads the token from the environment:

```
@caracal-lynx:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

The actual token never appears in the repo.

### 11.3 — Cloning and installing

```bash
# 1. Clone the client engagement repo (substitute for the right name)
git clone https://github.com/caracal-lynx/sluice-client-acme-corp.git
cd sluice-client-acme-corp

# 2. Install all dependencies — pulls @caracal-lynx/* from npm
npm install

# 3. Verify the sluice CLI resolves
npx sluice --version
```

`npm install` resolves the public `@caracal-lynx/sluice` plus whichever paid packages this engagement requires. Acme Corp's `package.json` declares `@caracal-lynx/sluice`, `@caracal-lynx/etl-rules-uk`, and `@caracal-lynx/sluice-adapter-ifs`. Style Co's adds `@caracal-lynx/etl-rules-fashion` and `@caracal-lynx/sluice-adapter-bluecherry` instead.

### 11.4 — Environment configuration

Sluice never reads credentials from YAML — only from environment variables, interpolated at config-load time via `${ENV_VAR}` tokens. The client repo ships a `.env.example` documenting every variable required.

```bash
cp .env.example .env
# Edit .env with the client's actual values
```

A typical `.env.example` for an MSSQL-source / IFS-target engagement:

```ini
# .env.example — copy to .env (which is gitignored) and fill in real values

# Source — Acme Corp legacy SQL Server
SOURCE_MSSQL=mssql://user:password@serverlegacy.example.local/LegacyDB

# Target — IFS bulk-import location (file-based, not REST)
IFS_IMPORT_PATH=C:\IFS\Import

# Output — where Sluice writes rejection CSVs, summaries, state files
SLUICE_OUTPUT_DIR=./output

# Runtime
NODE_ENV=development
LOG_LEVEL=info
```

### 11.5 — Running pipelines

```bash
# Validate config without running anything
npx sluice check pipelines/customers.pipeline.yaml

# DQ + transform only; no load
npx sluice validate pipelines/customers.pipeline.yaml

# Full run, dry-run mode (no output written)
npx sluice run --dry-run pipelines/customers.pipeline.yaml

# Full live run
npx sluice run pipelines/customers.pipeline.yaml
```

Convenience scripts in `package.json`:

```json
{
  "scripts": {
    "sluice:check": "sluice check pipelines/*.pipeline.yaml",
    "sluice:validate": "sluice validate pipelines/*.pipeline.yaml",
    "sluice:dry-run": "sluice run --dry-run pipelines/*.pipeline.yaml",
    "sluice:run": "sluice run pipelines/*.pipeline.yaml"
  }
}
```

```bash
npm run sluice:check
npm run sluice:dry-run
npm run sluice:run
```

### 11.6 — Output files

After a run, `${SLUICE_OUTPUT_DIR}` contains:

| File                     | Description                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `{name}-state.json`      | Run summary: row counts, durations, status, `lastRunAt` for incremental mode        |
| `{name}-rejected.csv`    | Rows that failed DQ rules — one row per violation, with field/rule/severity columns |
| `{name}-dq-summary.json` | Aggregate DQ statistics — counts by rule, counts by severity, by-field breakdown    |
| `{name}.duckdb`          | DuckDB staging file (deleted at end of run unless `--keep-staging`)                 |

### 11.7 — Updating Sluice

When Caracal Lynx releases a new version:

```bash
# Pull the bump PR if Renovate has merged it (Phase 7)
git pull

# Reinstall to pick up the new versions
npm install

# Sanity-check
npm run sluice:check
```

The client never edits version numbers manually — Renovate (Phase 7) bumps them and the client just merges the PR after CI passes.

### 11.8 — Local-setup flow at a glance

```mermaid
flowchart TD
    A["Install Node 24 LTS<br/>nodejs.org"] --> B["Install Git<br/>git-scm.com"]
    B --> C["Receive NPM_TOKEN<br/>from Caracal Lynx"]
    C --> D["Set NPM_TOKEN<br/>environment variable"]
    D --> E["git clone<br/>sluice-client-{name}"]
    E --> F["npm install<br/>(pulls @caracal-lynx/* packages)"]
    F --> G["cp .env.example .env<br/>fill in DB credentials + paths"]
    G --> H["npm run sluice:check<br/>validate config"]
    H --> I{"All pipelines valid?"}
    I -->|✅ Yes| J["npm run sluice:dry-run<br/>full pipeline rehearsal"]
    I -->|❌ No| K["Inspect error<br/>fix YAML / .env / credentials"]
    K --> H
    J --> L{"Dry run clean?"}
    L -->|✅ Yes| M["npm run sluice:run<br/>live migration"]
    L -->|❌ No| K
```

---

_Document maintained by Caracal Lynx Limited. Update this file when Phase 5 sub-tasks complete, when the post-launch topology changes, or when client setup steps shift. The matching master-plan section is [SLUICE-IMPLEMENTATION-PLAN.md §9](./SLUICE-IMPLEMENTATION-PLAN.md#9-phase-5--repo-restructure--open-source-launch)._
