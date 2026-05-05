# Templates

Reference files copied directly into private downstream repos. Not consumed by
the public `@caracal-lynx/sluice` package or its CI — they exist here so the
configuration shape stays under version control alongside the project that
governs the cascade ([Phase 7](../PHASE-07-git-npm-workflow-spec.md)).

## `renovate-downstream.json`

Drop into the root of each **internal/intermediate** private repo:

- `caracal-lynx/sluice-enrich`
- `caracal-lynx/sluice-rules`
- `caracal-lynx/sluice-adapter-ifs`
- `caracal-lynx/sluice-adapter-bc`
- `caracal-lynx/sluice-adapter-bluecherry`

Patch bumps of `@caracal-lynx/*` auto-merge via `automergeType: branch` (no PR
churn for routine version bumps). Minor bumps open a PR for human review. Major
bumps open a PR with a `major-bump` label and never auto-merge.

## `renovate-downstream-client.json`

Drop into the root of each **client engagement** private repo:

- `caracal-lynx/sluice-client-acme-corp`
- `caracal-lynx/sluice-client-style-co`

Same patch-vs-major policy as the internal template, but `automergeType: pr`
(rather than `branch`) so client repos always have a visible PR record of
every dependency change. Major bumps additionally get the `client-impact`
label so they're not landed without explicit client engagement.

## How to use

1. Create the downstream repo (private, with a minimal `package.json` listing
   `@caracal-lynx/sluice` as a peer/regular dep — see Phase 7 spec Stage 0.3).
2. Copy the appropriate template file to the repo root as `renovate.json`.
3. Commit and push.
4. Within ~1 h, the Renovate GitHub App opens an Onboarding PR — review and
   merge it. After that the repo is part of the cascade.

If the policy changes, edit the template here and **re-sync each downstream
repo manually** — there is no automated propagation. Cascading config changes
across N repos defeats the point of having a checked-in template.

## Why `rangeStrategy: "bump"` for `@caracal-lynx/*`

Without it, Renovate's default `rangeStrategy` for caret-ranged dependencies
(`^0.1.2`) is `replace` (or `widen` for peer deps), which only opens a PR
when the new version is *outside* the current range. A patch bump like
`0.1.2 → 0.1.3` falls *inside* `^0.1.2`, so by default no PR is created and
consumers pick up the new version silently on their next `npm install`.

For Phase 7's cascade to be visible — which is the whole point of having a
release pipeline that emits a chain of PRs — we need every patch to actually
open a PR in every downstream repo. `"rangeStrategy": "bump"` instructs
Renovate to bump the range minimum (`^0.1.2 → ^0.1.3`) on every release,
making each version change a tracked change.

For non-`@caracal-lynx/*` packages, Renovate's default behaviour is
unchanged.
