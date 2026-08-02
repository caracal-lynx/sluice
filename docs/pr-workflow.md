# Sluice — PR Workflow

Operational guide for creating, reviewing, approving, and merging pull
requests against `caracal-lynx/sluice`. Reflects the branch rulesets
live on the repo as of **2026-05-18** ([PR #125](https://github.com/caracal-lynx/sluice/pull/125)).

Companion to [`branching-strategy.md`](./branching-strategy.md) — that doc
is the convention (branch names, commit format); this doc is the
mechanics (how the rulesets gate merges, what auto-fires, how to bypass).

---

## TL;DR

| Author of PR                              | Approval path | Merge command                                        |
| ----------------------------------------- | ------------- | ---------------------------------------------------- |
| You (admin)                               | Admin bypass  | `gh pr merge <num> --squash --admin --delete-branch` |
| `renovate[bot]`                           | Bypassed      | Auto, on Renovate's schedule                         |
| `caracal-lynx-releaser[bot]` (release PR) | Bypassed      | Auto, once `test` is green                           |
| Future human contributor                  | Your approve  | `gh pr review <num> --approve` then `gh pr merge`    |

Every PR — regardless of author — must pass the `test` status check
and have all conversations resolved. Neither rule is bypassable.

---

## What's enforced (branch rulesets)

Two rulesets target `refs/heads/master`. Both `active`. Source-of-truth
is GitHub's live state; the JSON in [`.github/rulesets/`](../.github/rulesets/)
is versioned for reproducibility and disaster recovery.

### A. `Protect master (structural)` — id `16544364`

Bypass list **empty**. Applies to everyone with no exceptions.

| Rule                                | Effect                                            |
| ----------------------------------- | ------------------------------------------------- |
| `deletion`                          | `master` cannot be deleted                        |
| `non_fast_forward`                  | Force-pushes to `master` blocked                  |
| `required_linear_history`           | Merge commits blocked — squash/rebase only        |
| `pull_request` (approvals = 0)      | Direct push blocked; PR is required               |
| `required_review_thread_resolution` | All conversations must be resolved before merge   |
| `required_status_checks: [test]`    | The `test` CI job must pass                       |
| `copilot_code_review`               | Copilot is auto-requested as reviewer on every PR |

### B. `Master review gate` — id `16544434`

Layered on top. Adds the formal-approval gate with a bypass list.

| Rule                                  | Effect (for non-bypass actors)                   |
| ------------------------------------- | ------------------------------------------------ |
| `required_approving_review_count: 1`  | One approving review required                    |
| `dismiss_stale_reviews_on_push: true` | Push after approval re-opens the gate            |
| `require_last_push_approval: true`    | The approver must have seen the most recent push |

**Bypass list** (all with `bypass_mode: pull_request` — bypass applies
to PR merges only; direct/force pushes still blocked by Ruleset A):

| Actor                   | `actor_type`     | `actor_id` |
| ----------------------- | ---------------- | ---------- |
| Repository admins       | `RepositoryRole` | `5`        |
| `renovate[bot]`         | `Integration`    | `2740`     |
| `caracal-lynx-releaser` | `Integration`    | `3756937`  |

---

## Creating a PR

```pwsh
git checkout -b <prefix>/<short-descriptive-slug>
# ...make changes...
git add <files>
git commit -m "[<prefix>/<short-descriptive-slug>] - <subject>"
git push -u origin <prefix>/<short-descriptive-slug>
gh pr create --title "<emoji> <type>: <subject>" --body "..."
gh pr merge --auto --squash --delete-branch
```

Branch prefix and commit-subject prefix conventions:
[`branching-strategy.md`](./branching-strategy.md#branch-naming).
Emoji conventions in the recent commit log: 🛡️ security/policy,
🔒 vuln-fix, 🤖 bot config, ✨ feature, 🔧 chore, 🐛 fix, 🧹 cleanup,
📝 docs.

### What runs automatically when you open the PR

| Action                                                           | When                                                                                                                      | Source                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `test` job (lint + typecheck + build + test:cov)                 | every PR                                                                                                                  | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)     |
| `Analyze (javascript-typescript)` / `Analyze (actions)` (CodeQL) | every PR                                                                                                                  | GitHub default security setup                                 |
| `Build` (Astro docs site)                                        | only PRs touching `docs-site/**`, `src/config/schema.ts`, `CHANGELOG.md`, `PLUGINS.md`, `README.md`, or the docs workflow | [`.github/workflows/docs.yml`](../.github/workflows/docs.yml) |
| Copilot code review                                              | every PR                                                                                                                  | Ruleset A `copilot_code_review` rule                          |

Only `test` is a **required** status check. The others are informative.

---

## Review

### Copilot's review

Copilot is auto-requested as a reviewer on every PR and replies with a
`COMMENT` review (usually within 30s). Read its comments — they often
flag real issues before you self-review.

GitHub policy: **Copilot's reviews never count toward the approval
requirement.** Copilot can only post `COMMENT` reviews, never `APPROVE`
or `REQUEST_CHANGES`. Its role is a quality assist, not an approval
shortcut.

To re-request after pushing fixes:

```pwsh
gh pr edit <num> --add-reviewer @copilot
```

### Your review (for someone else's PR)

```pwsh
gh pr review <num> --approve --body "<optional notes>"
gh pr review <num> --request-changes --body "<what to change>"
gh pr review <num> --comment --body "<comments only>"
```

Or use the UI Files-changed → "Start a review" flow.

### Self-review of your own PR

GitHub forbids self-`APPROVE`. The `Approve` option is hidden in the UI
for your own PRs, and `gh pr review --approve` returns 422
_"Can not approve your own pull request"_. That's why the
`RepositoryRole: admin` bypass exists on Ruleset B — without it, every
solo-authored PR would be permanently blocked.

You can still `--comment` on your own PR (useful for noting decisions
or self-flagging concerns the next reviewer should look at).

---

## Approving and merging

### Your own PR — admin bypass

```pwsh
gh pr merge <num> --squash --admin --delete-branch
```

The `--admin` flag is **required**. Without it, `gh` refuses because
`mergeStateStatus` reports `BLOCKED` (the approval gate is not
satisfied; admins are _allowed_ to bypass it but `gh` doesn't
auto-detect that without the flag).

UI equivalent: scroll to the merge box at the bottom of the PR → look
for **`Merge without waiting for requirements`** (or **`Merge anyway`**;
exact wording varies) → confirm.

The audit log records `bypassed branch protection (Ruleset B)` for the
admin actor, not `approved by`.

### Someone else's PR

Approve, then merge:

```pwsh
gh pr review <num> --approve --body "<notes>"
gh pr merge <num> --squash --delete-branch
```

`--admin` not needed — the approval satisfies Ruleset B normally.

### Renovate PRs

No action. Renovate manages its own merging on schedule
(`before 8am every weekday` per [`renovate.json`](../renovate.json)).
Patch and minor bumps are `automerge: true`; major bumps are
`automerge: false` and need a manual review on the dependency
dashboard.

Renovate bypasses Ruleset B (on the list as `Integration:2740`), so it
can merge its own PRs without an approval — but it still has to pass
the `test` check from Ruleset A.

### Release PRs

The `chore(release): version packages` PR is opened by
`caracal-lynx-releaser[bot]` (the `caracal-lynx-releaser` GitHub App,
`actor_id: 3756937`). It bypasses Ruleset B and auto-merges once
`test` passes. On merge of the release PR, the Release workflow on
master publishes to npm via Trusted Publishing (OIDC).

Workflow:
[`.github/workflows/release.yml`](../.github/workflows/release.yml)

App credentials:

- `vars.RELEASER_APP_ID` = `3756937`
- `secrets.RELEASER_PRIVATE_KEY` (RSA private key)

The release workflow has a preflight check — if either is unset, it
falls back to the default `GITHUB_TOKEN` and warns. The release PR
then can't auto-merge (no bypass) and needs admin approval.

---

## Modifying the rulesets

Edit the JSON on a branch, then `PUT` it to the live ruleset by id:

```pwsh
# Structural (id 16544364)
gh api repos/caracal-lynx/sluice/rulesets/16544364 -X PUT `
  --input .github/rulesets/protect-master-structural.json

# Review gate (id 16544434)
gh api repos/caracal-lynx/sluice/rulesets/16544434 -X PUT `
  --input .github/rulesets/master-review-gate.json
```

Verify:

```pwsh
gh api repos/caracal-lynx/sluice/rulesets `
  --jq '.[] | {id, name, enforcement}'

gh api repos/caracal-lynx/sluice/rulesets/<id> `
  --jq '{rules: [.rules[].type], bypass_actors, current_user_can_bypass}'
```

Notes:

- `ref_name.include` must use the fully-qualified form
  `refs/heads/master` (or `~DEFAULT_BRANCH`). Plain `master` is
  rejected with `Invalid target patterns: 'master'`.
- The JSON files don't apply themselves — GitHub's live state is the
  source of truth. The repo copy is for reproducibility / audit / DR.
- `current_user_can_bypass` in the API response confirms whether the
  caller (your token) is on the bypass list. Values: `never`,
  `pull_requests_only`, `always`.

---

## Why the bypass list looks the way it does

- **Admin (RepositoryRole 5)** is on the gate (B) only, not the
  structural ruleset (A). Admins can override approval requirements on
  their own PRs but cannot bypass `test`, conversation resolution, or
  the linear-history / force-push restrictions.
- **`github-actions[bot]` cannot be added as a bypass actor at the
  repo level.** GitHub rejects it with _"Actor GitHub Actions
  integration must be part of the ruleset source or owner
  organization"_. That's why the release flow uses the dedicated
  `caracal-lynx-releaser` GitHub App instead of the default
  `GITHUB_TOKEN`.
- **`renovate[bot]`** is on (B) so dep-bump PRs auto-merge without
  approval; it is NOT on (A) so Renovate PRs still have to pass `test`.

---

## Reference

| Thing                        | Value / link                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Live rulesets UI             | https://github.com/caracal-lynx/sluice/rules                                                            |
| Structural ruleset id        | `16544364`                                                                                              |
| Review-gate ruleset id       | `16544434`                                                                                              |
| Required check name          | `test`                                                                                                  |
| Renovate app id              | `2740`                                                                                                  |
| caracal-lynx-releaser app id | `3756937`                                                                                               |
| Repository admin role id     | `5`                                                                                                     |
| Renovate config              | [`renovate.json`](../renovate.json)                                                                     |
| CI workflow                  | [`ci.yml`](../.github/workflows/ci.yml)                                                                 |
| Docs workflow                | [`docs.yml`](../.github/workflows/docs.yml)                                                             |
| Release workflow             | [`release.yml`](../.github/workflows/release.yml)                                                       |
| Ruleset JSON (A)             | [`.github/rulesets/protect-master-structural.json`](../.github/rulesets/protect-master-structural.json) |
| Ruleset JSON (B)             | [`.github/rulesets/master-review-gate.json`](../.github/rulesets/master-review-gate.json)               |
