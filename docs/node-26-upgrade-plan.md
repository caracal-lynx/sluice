# Node 26 LTS upgrade plan

**Target date:** October 2026 (when Node 26 enters Active LTS)
**Drafted:** 2026-05-08
**Owner:** Michael Scott

Coordinated upgrade of the Sluice core, the private enrich package, and both
client repos from Node 24 LTS to Node 26 LTS. Park this until v26 hits LTS,
then work through it top-to-bottom in a single sitting. The whole point of
waiting is to avoid forcing plugin authors and live client engagements onto
a non-LTS runtime — so don't start early "just to get ahead".

---

## Pre-flight (do first, on the day)

- [ ] Confirm Node 26 has officially entered Active LTS on
      <https://nodejs.org/en/about/previous-releases>. Do **not** start on
      a Current-phase release.
- [ ] Run `npm outdated` in each of the four repos; note anything else
      worth bundling into the upgrade PR.
- [ ] Verify Node 26 support in the critical native deps:
  - [ ] `@duckdb/node-api` (ABI-stable, low risk — but still confirm)
  - [ ] `mssql`
  - [ ] `pg`
- [ ] Verify dev-tool support: `tsx`, `vitest`, `eslint`,
      `@typescript-eslint`, `prettier`.
- [ ] Spot-check `actions/setup-node@v4` accepts `'26'` (it should — it
      consumes whatever version string you pass).

## Core repo (`sluice`)

- [ ] Branch off master: `chore/node-26-upgrade`
- [ ] `package.json` → `engines.node`: `>=24.0.0` → `>=26.0.0`
- [ ] `.github/workflows/ci.yml` → `node-version: '24'` → `'26'`
- [ ] `CLAUDE.md` → "Runtime: Node.js 24 LTS" → "Node.js 26 LTS" in the
      technology stack table near the top.
- [ ] `README.md` → any "requires Node 24" mentions.
- [ ] `PLUGINS.md` → bump the minimum Node version note.
- [ ] `tsconfig.json` → leave `target` alone unless there's a concrete reason
      to bump it. Don't ride the upgrade to chase unrelated changes.
- [ ] Local validation on v26: `npm ci && npm run lint && npm run build && npm test`
- [ ] CI green on v26.
- [ ] Bump package version — minor bump unless the plugin contract changes.
- [ ] Tag a pre-release first (e.g. `1.x.0-rc.1`) and smoke-test before
      promoting `latest`.

## Enrich repo (`@caracal-lynx/sluice-enrich`)

- [ ] Branch: `chore/node-26-upgrade`
- [ ] `package.json` → `engines.node` bump
- [ ] CI workflow → `node-version` bump
- [ ] Peer dep on `@caracal-lynx/sluice` — ensure it accepts the new core
      version (or bump the floor).
- [ ] Test all three built-in providers on v26:
  - [ ] `vies` (EU VAT)
  - [ ] `hmrc-vat`
  - [ ] `uk-trade-tariff`
- [ ] Verify the optional-dependency injection still works with the new
      core version — i.e. `registerEnrichPhase()` is still picked up by
      `PipelineRunner` and the enrich phase doesn't silently skip.
- [ ] Republish as `1.1.0` (no API break, just runtime floor).

## Client repos

Coordinate timing with each client. Do **not** bump mid-migration. Pick a
quiet window with no scheduled runs.

### `sluice-client-cochran` (public name: Acme Corp; target: IFS)

- [ ] CI workflow → `node-version` bump
- [ ] README / setup notes → Node 26 LTS
- [ ] Bump `@caracal-lynx/sluice` to the v26-compatible release
- [ ] Dry-run the customer / item / vendor pipelines on v26
- [ ] Confirm with client before merging

### `sluice-client-eribe` (public name: Style Co; target: BlueCherry)

- [ ] CI workflow → `node-version` bump
- [ ] README / setup notes → Node 26 LTS
- [ ] Bump `@caracal-lynx/sluice` dependency
- [ ] Dry-run the styles / vendors / purchase-orders pipelines on v26
- [ ] Confirm with client before merging

## External plugin authors

If any third-party Tier 3 plugins exist by October 2026:

- [ ] Audit npm for packages declaring a peer dep on `@caracal-lynx/sluice`.
- [ ] Issue / email heads-up at least 2 weeks before the core release.
- [ ] Document the v24 → v26 transition in `PLUGINS.md`.

## Renovate

- [ ] Verify `renovate.json` hasn't silently merged dependency bumps that
      drop v24 support before this coordinated upgrade lands.
- [ ] After the upgrade, let Renovate flow normally again.

## Rollback plan

If anything blows up post-release:

- [ ] Revert dist-tag: `npm dist-tag add @caracal-lynx/sluice@<previous> latest`
- [ ] Same for `@caracal-lynx/sluice-enrich`
- [ ] Keep Node 24 install instructions in `README.md` until every client
      is confirmed running on v26.
- [ ] Pin client repos back to the previous package versions if needed.

## Sequencing

This is a stacked-PR situation across four repos. Land in this order:

1. `sluice` core
2. `@caracal-lynx/sluice-enrich` (depends on the new core)
3. `sluice-client-cochran` (depends on both)
4. `sluice-client-eribe` (depends on both)

See [git-workflow-lessons.md](git-workflow-lessons.md) for the stacked-PR
protocol. Don't `--no-verify` or skip CI to "save time" — the whole point
of this exercise is to validate v26 cleanly.
