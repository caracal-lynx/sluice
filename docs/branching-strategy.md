# Sluice — Branching Strategy

> Working convention for the public `caracal-lynx/sluice` repo and its private siblings (`sluice-enrich`, `sluice-rules`, adapter repos, client repos). Lifted out of [PHASE-05-DEVELOPMENT-WORKFLOW.md](./PHASE-05-DEVELOPMENT-WORKFLOW.md) so the Phase 5 spec can stay focused on the open-source launch.

**Owner:** Caracal Lynx Limited · Michael Scott

---

## TL;DR

- **Single protected branch: `master`.** No `develop`. PRs target `master` directly.
- Branch naming: `feat/...`, `fix/...`, `docs/...`, `chore/...`, `hotfix/...`.
- Every commit message starts with `[<branch-name>] - ` (existing convention — see commit log).
- Conventional-commits prefix in the body where useful (`feat:`, `fix:`, `docs:`, `chore:`).
- Hotfixes branch from `master`, merge straight back. Same rules as a normal PR.
- The same convention applies in every Sluice repo (public and private) so the Renovate cascade (Phase 7) sees a uniform shape.

---

## Branch model

```
master  ────●────●────●────●────●────●────●────●────────────  (protected, always green)
            │         │              │         │
            │         │              │         └── hotfix/credential-leak  →  PR  →  master
            │         │              │
            │         │              └── feat/source-adapter-graphql  →  PR  →  master
            │         │
            │         └── fix/dq-engine-null-handling  →  PR  →  master
            │
            └── docs/branching-strategy  →  PR  →  master
```

`master` is the only long-lived branch. Feature, fix, docs, and chore branches are short-lived (typically open for hours-to-days, not weeks). Branches are deleted once their PR merges — `Settings → General → Automatically delete head branches: ON`.

There is **no `develop` branch.** The earlier draft of [PHASE-05-DEVELOPMENT-WORKFLOW.md](./PHASE-05-DEVELOPMENT-WORKFLOW.md) prescribed a `develop` integration branch. That has never matched what the repo's commit log actually shows, and for a two-person consultancy the extra branch buys nothing. PRs target `master` directly. CI keeps `master` green.

---

## Branch naming

| Prefix | Use for | Example |
|---|---|---|
| `feat/` | New behaviour visible to users (CLI flag, YAML schema field, adapter, transform type) | `feat/multi-source-merge` |
| `fix/` | Bug fix that doesn't change the public API | `fix/duckdb-bom-handling` |
| `docs/` | Documentation only — no `src/` changes | `docs/branching-strategy` |
| `chore/` | Tooling, CI, lockfile, dependency bumps | `chore/eslint-9-upgrade` |
| `hotfix/` | Urgent fix that needs to ship the same day | `hotfix/credential-leak` |
| `feature/` | (Legacy spelling — see existing branches in the log) Same meaning as `feat/`; new branches should prefer `feat/` | `feature/upgrade-node-v24` |

Use lowercase + hyphens. Avoid issue numbers in branch names (they go in PR titles / commit bodies, where they're navigable).

---

## Commit message format

Per the project's existing memory ([commit_message_format](../../../../Users/MichaelScott/.claude/projects/C--Dev-Projects-TypeScript-sluice/memory/feedback_commit_message_format.md)):

```
[<branch-name>] - <short summary>

<body — optional; conventional-commits prefix where useful>

<footer — Co-Authored-By, Closes #N, etc.>
```

Examples (drawn from the actual `git log`):

```
[master] - 📝 Add Phase 7 git/npm workflow spec, update implementation plan references, and log file for pipeline execution

[feature/upgrade-node-v24] - ⚡ Upgrade Node.js 20 → 24 LTS and migrate DuckDB to @duckdb/node-api (#8)

[docs/post-node24-status] - 📝 Mark Phase 1 (Node 24 + DuckDB Neo) complete in implementation plan (#9)
```

The leading `[<branch-name>]` makes the log readable when you look at it as a stream of work-streams rather than a chronological list. Don't drop it.

Emojis at the start of the summary are fine but optional. They function as a quick scan-aid (📝 docs, ⚡ perf, 🛠️ chore, 🐛 fix, 🚀 feat).

---

## PR conventions

- **One PR per branch.** Don't pile multiple unrelated changes onto one branch.
- **Title** = the short summary, no `[<branch-name>]` prefix (the PR UI shows the branch name separately).
- **Description** = what changed and why; a short test plan; closes-issue references where applicable.
- **Squash-merge by default.** Keeps `master` history linear (enforced by Ruleset A — see [`pr-workflow.md`](./pr-workflow.md)). The branch's per-commit history is preserved on the branch itself in the PR record.

Don't squash-merge if a feature branch contains a deliberate sequence of well-crafted commits (e.g. an upgrade with checkpoints) that you want preserved on `master`. In that case, rebase-merge.

The mechanics of what's required to merge — CI status checks, approval requirements, admin/bot bypass paths — are documented in [`pr-workflow.md`](./pr-workflow.md). That doc tracks the live branch-ruleset state; this section intentionally avoids restating it to prevent drift.

---

## Stacked PRs — the protocol (and why we mostly avoid them)

A "stacked PR" is one whose base branch is another open PR's head, not `master`. Visually clean diffs are the appeal: each PR shows only its own delta. The cost is **cascade-class failure modes** at merge time.

### Default — branch every feature off `master`

This is the working rule. The Phase 4b provider PRs taught us why: branching `feat/phase-4b2-hmrc` off `feat/phase-4b1-vies` (instead of `master`) meant that when the parent merged with `--delete-branch`, GitHub **closed the child PR** rather than auto-retargeting it. See [git-workflow-lessons.md](./git-workflow-lessons.md#1-stacked-pr-auto-close-cascade--the-worst-incident-of-the-week) for the full incident.

The cost of branching off `master` directly is occasional small merge-conflicts at PR time. The cost of stacking is the entire cascade-failure class. Pay the small cost.

### When stacking is genuinely necessary

Only when a child PR cannot exist without its parent's code — e.g. PR-2 imports a symbol that PR-1 introduces, with no sensible way to land them in either order. In that case:

1. **Pre-retarget every child PR to `master` BEFORE merging the parent.** Even if you intend `--delete-branch`. Run:
   ```powershell
   gh pr edit <child-pr> --base master
   ```
2. Merge the parent normally (squash + `--delete-branch` is fine — children are now retargeted, so they don't care about the deletion).
3. Rebase each child against the new `master` and force-push:
   ```powershell
   git checkout <child-branch>
   git rebase origin/master
   git push --force-with-lease origin <child-branch>
   ```
4. Continue merging the chain.

### If the cascade fires anyway (recovery)

If a child PR auto-closed because you forgot step 1: **don't try `gh pr reopen` or `gh pr edit --base`.** Both fail on closed PRs. Path B is faster:

```powershell
# The head branch still exists locally and on origin
git push origin <child-head-branch>   # idempotent; ensures origin has it
gh pr create --base master --head <child-head-branch> ...
```

The original PR stays closed in history; the replacement carries the same commits forward and goes through merge normally. The full recipe is in [git-workflow-lessons.md → Recipe A](./git-workflow-lessons.md#recipe-a--restore-a-stacked-pr-that-auto-closed).

---

## Hotfix flow

Same as a normal PR — branch from `master`, fix, PR, merge, delete branch. The `hotfix/` prefix is purely a signal (to the reviewer, to anyone watching CI) that "this should ship today, please prioritise review." It does not bypass branch protection. CI still runs.

If a hotfix needs to skip a hook (signing, tests temporarily disabled), that is **not** approved by the `hotfix/` prefix. Use the standard process: investigate the underlying cause, fix it, document the workaround in the PR, and re-enable the hook in a follow-up PR. Sluice's policy is no `--no-verify`.

---

## Tag conventions

Tags are created by the Phase 7 release workflow (Changesets bot), not manually. Format: `v<major>.<minor>.<patch>` per semver. The first public release will be `v1.0.0`.

Until Phase 7 is wired up, tagging is on a best-effort basis. The Phase 1 Node-24 upgrade was a manual `git tag` on PR-merge (PR #8 → squash commit `e1be8c4`); subsequent phases haven't tagged. After Phase 7, every change reaching `master` with a `.changeset/` entry triggers a tagged release automatically.

---

## Why this shape (not GitFlow, not trunk-based-with-feature-flags)

GitFlow's `develop` + `release/*` branches are designed for a release cadence where a release contains many features integrated over weeks. Sluice's release cadence is "every change is a release" (Phase 7 ships a new `@caracal-lynx/sluice` version on every Changeset), so the integration buffer that GitFlow provides is wasted.

Trunk-based development with feature flags is designed for teams large enough that two contributors might step on each other inside a single hot path. Sluice's primary contributor is one person plus AI-assisted PRs; conflict is rare enough that flagging incomplete work into `master` is more overhead than it's worth.

The model above is closest to **trunk-based-without-flags**, with short-lived branches as the unit of integration. It matches the size of the team, the release cadence, and the existing commit log.

---

*Document maintained by Caracal Lynx Limited. If this convention changes — e.g. a `develop` branch is reintroduced for a coordinated multi-week effort — update this file before opening the first branch under the new shape.*
