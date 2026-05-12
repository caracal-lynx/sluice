# Sluice — Git & GitHub Workflow Lessons

> Post-mortem record of git/GitHub incidents during the May 2026 push to ship Phases 1–8 of Sluice plus the private `@caracal-lynx/sluice-enrich@1.0.0` package. Captures what went wrong, why, and what to do next time. Companion to [`branching-strategy.md`](./branching-strategy.md) — that doc is the convention; this doc is the lived experience.
>
> **Owner:** Caracal Lynx Limited · Michael Scott
> **Last updated:** 2026-05-07

---

## TL;DR — the three rules that would have prevented the worst pain

1. **Branch every feature off `master`, not off the previous PR's tip.** Stacked branches make diffs visually clean but cause cascade-class problems on merge with `--delete-branch`.
2. **Pre-flight every implementation plan with a verification pass.** Cheap; high return; surfaces "this assumption is wrong" before the implementation starts.
3. **CLI version strings must read `package.json` at runtime.** Hardcoding a version literal is a guaranteed drift bug waiting for the next release.

---

## Incident catalogue

### 1. Stacked-PR auto-close cascade — the worst incident of the week

**When:** Phase 4b providers, 7 May 2026.

**What happened.** The three provider PRs (`vies`, `hmrc-vat`, `uk-trade-tariff`) were stacked: each branched off the previous tip rather than off `master`. The intent was visually clean per-PR diffs. When the parent PR was squash-merged with `--delete-branch`, GitHub deleted the base branch. Instead of auto-retargeting the child PR to `master`, **GitHub closed the child PR**.

**Recovery friction.**

- `gh pr edit <child> --base master` was rejected with *"Cannot change the base branch of a closed pull request"*. There is no `gh pr reopen --retarget` flow.
- Solution: create a fresh PR from the same head branch, targeting `master` directly. The original PR stays closed in history; the replacement PR carries the same commits forward.
- After fixing the base, the first merge attempt failed with *"merge commit cannot be cleanly created"*. Stacked-history confused git's 3-way merge. Recovery: `git rebase origin/master` locally (cherry-pick detection cleanly skipped already-applied commits), then `git push --force-with-lease`.

**Root cause.** A wrong default. We assumed GitHub would auto-retarget child PRs the way it does for `main`/`master`-prefixed flows in some contexts. The actual behaviour is: **if a child's base branch ceases to exist, the child PR closes, period.** No warning at parent merge time.

**Lesson and prevention.**

- ⭐ **Default: branch every feature off `master`.** Costs an occasional small merge-conflict at PR time; saves the entire cascade-failure class.
- If you must stack (rare — only when a child genuinely cannot exist without its parent): **pre-retarget every child PR to `master` BEFORE merging the parent**, via `gh pr edit <n> --base master`. Do this even if you intend `--delete-branch` on the parent.
- If you forget and the cascade fires: don't try to reopen. Path B is faster — create a fresh PR from the same head branch targeting `master`.

---

### 2. CLI hardcoded version drift

**When:** Discovered 7 May 2026 after `@caracal-lynx/sluice@0.2.0` shipped.

**What happened.** `program.version('0.1.0')` was hardcoded as a string literal in `src/cli.ts` (line 353). After `0.2.0` published to npm, `sluice --version` kept returning `0.1.0`. The bug was masked locally by a global `npm link` to the dev clone — so the developer running `sluice --version` saw the dev tree's version (which was being bumped by Changesets), not the npm-installed version. End users would have seen the bug immediately.

**Recovery.** Replaced the literal with a `readPackageVersion()` helper that reads the version dynamically from `package.json` at runtime. Shipped as `0.2.1`.

**Lesson.** Any CLI tool's `--version` must read `package.json` at runtime, never a hardcoded literal. Make this a code-review item — easy to miss in a fresh CLI scaffold.

---

### 3. Astro/MDX silent breakages on the docs site

**When:** Phase 8 docs site rebuilds, 6–7 May 2026.

**What happened.** The Pipeline YAML Schema page (`pipeline-yaml.md`) used `import` statements + JSX. Plain `.md` doesn't parse those — only `.mdx` does. Three failure modes compounded:

1. The schema-reference generator emitted a `Record<string, string>` literal in body text. MDX parsed `<string` as a JSX-tag-opener and the build broke with a confusing "expected closing tag" error miles from the actual cause.
2. An HTML `<!-- ... -->` comment between the frontmatter and the import block silently broke MDX's import detection — the imports were treated as body text.
3. The build error pointed at "line N of generated file" without flagging that the file extension was the actual root cause.

**Recovery.** Renamed `pipeline-yaml.md` → `pipeline-yaml.mdx`. Updated the generator to emit `.mdx` and use JSX comments (`{/* ... */}`) at the top. Wrapped TypeScript generic types in backticks so MDX never sees them as JSX.

**Lesson.** For Astro Starlight: pages with `import` statements or JSX must be `.mdx`. Wrap TypeScript generic-type literals in backticks. Use `{/* */}` comments, never HTML `<!-- -->`.

---

### 4. Renovate race on dependency-bump PR

**When:** Cochran client repo dep bump, 7 May 2026.

**What happened.** While preparing a PR to bump `@caracal-lynx/sluice` from `^0.1.2` → `^0.2.1` and add `@caracal-lynx/sluice-enrich@^1.0.0`, Renovate auto-merged its own bump from `^0.1.2` → `^0.1.3` on `master`. The branch's PR went `DIRTY` on first push.

**Recovery.** Local rebase against `origin/master`, kept the `^0.2.1` line in the conflict resolution, force-pushed.

**Lesson.** Before pushing a fresh dep-bump branch on a quiet repo, run `git fetch && git log HEAD..origin/master` to see if Renovate has already moved the goalposts. Cheap check; avoids the conflict-resolution scramble.

---

### 5. Stale Claude Code worktree

**When:** Discovered 7 May 2026; had been present for several days.

**What happened.** A Claude Code session created `.claude/worktrees/angry-brown-99e75e` holding `master` open in a subdirectory of the main `sluice` checkout. The session ended without removing the worktree. Routine `git checkout master` in the main worktree failed with *"'master' is already used by worktree at ..."* — a confusing error if you don't know what's holding it.

**Recovery.** `git worktree remove .claude/worktrees/angry-brown-99e75e` after verifying it had no uncommitted changes.

**Lesson.** Worktrees from background sessions need explicit cleanup. Either prune at session end, or carry a memory note into the next session so they get tidied up early.

---

### 6. Duplicate licence FAQ file

**When:** Discovered 7 May 2026 during this retrospective.

**What happened.** `docs/LICENCE-FAQ.md` AND `docs/licensing-faq.md` both existed in the repo, with effectively identical content. PR #57 had correctly `git mv`'d the root `LICENCE-FAQ.md` to `docs/licensing-faq.md` to dodge GitHub's `licensee` filename-pattern detection — but there was *already* a `docs/LICENCE-FAQ.md` from a much earlier "Add comprehensive documentation" big-bang commit (`aa72c28`). The duplicate was never noticed because `licensee` only scans the repo root, not `docs/`.

**Recovery.** This very PR (`chore/git-retro-followup`) deletes `docs/LICENCE-FAQ.md`.

**Lesson.** When moving a file out of a directory that already contains a similarly-named file, check both before and after. `git ls-files | grep -i <stem>` catches near-duplicates that `ls` of either directory alone doesn't.

---

## Patterns that worked — keep doing these

| Habit | Why it paid off |
|---|---|
| `--force-with-lease`, never bare `--force` | The safety net was always there; zero accidental overwrites |
| Squash-merge by default | Linear `master` history; per-commit detail kept on PR record |
| CI as merge gate (lint + typecheck + test required) | Prevented bug compounding across the cascade |
| `gh pr merge --auto` for CI-bound PRs | Used successfully on PR #56; no polling needed |
| Stage-cut releases (`0.1.0` framework → `0.2.0` provider 1 → `1.0.0` full) | Each ship validated framework correctness before adding integration risk |
| Pre-flight verification before drafting plans | Found that DuckDB's built-in `rowid` was sufficient — collapsed an entire planned OSC PR |
| `[<branch-name>] - ` commit prefix | Made `git log` scannable as work-streams in retrospect |
| Memory-driven session continuity | Phase queue + cascade lesson notes carried context across context-window compactions |
| OIDC Trusted Publishing | Survived the November 2025 Classic Automation token retirement gracefully |

---

## Recovery recipes

### Recipe A — Restore a stacked PR that auto-closed

```powershell
# The child PR auto-closed because its base branch was deleted.
# Don't try `gh pr reopen` or `gh pr edit --base` — both fail on closed PRs.

# 1. Confirm the head branch still exists locally
git -C C:\Dev\Projects\TypeScript\<repo> branch --list <child-head-branch>

# 2. Push it again to make sure origin has it
git -C C:\Dev\Projects\TypeScript\<repo> push origin <child-head-branch>

# 3. Open a fresh PR targeting master directly
gh pr create --repo <org>/<repo> --base master --head <child-head-branch> `
  --title "..." --body "$(cat <<'EOF'
... (note in description that this replaces auto-closed PR #<N>)
EOF
)"
```

### Recipe B — Stacked-history "merge commit cannot be cleanly created"

```powershell
git -C <repo> checkout <branch>
git -C <repo> fetch origin
git -C <repo> rebase origin/master   # cherry-pick detection cleanly skips already-applied commits
git -C <repo> push --force-with-lease origin <branch>
# Then re-trigger merge
gh pr merge <N> --repo <org>/<repo> --squash --delete-branch
```

### Recipe C — Stale worktree cleanup

```powershell
# List all worktrees
git -C <repo> worktree list

# Verify the stale one has no uncommitted work
git -C <stale-worktree-path> status
# Expect: "nothing to commit, working tree clean"

# Remove it (refuses if dirty; add --force only after verifying)
git -C <repo> worktree remove <stale-worktree-path>
```

### Recipe D — Squash-merge local-branch cleanup

```powershell
# After squash-merge, the local branch's HEAD has a different SHA than master.
# `git branch -d` (safe delete) refuses; `-D` (force delete) is correct here.
git -C <repo> checkout master
git -C <repo> pull --ff-only origin master
git -C <repo> fetch --prune origin
git -C <repo> branch -D <merged-branch-1> <merged-branch-2> ...
```

### Recipe E — Multi-PR rebase chain when several PRs touch the same file

After merging one of N PRs that touch overlapping files:

```powershell
# Re-check mergeability of the remaining PRs
for ($n in <pr-numbers>) {
  gh pr view $n --repo <org>/<repo> --json mergeable,mergeStateStatus -q .
}
# Any DIRTY/CONFLICTING ones need rebase before the next merge.
```

---

## Operating principles for future cascades

1. **Default to branching off `master`.** No stacked PRs unless genuinely necessary.
2. **Use `gh pr merge --auto` once CI passes are reliable.** Stops needless polling.
3. **Force-with-lease, never bare force.**
4. **Pre-flight every plan.** A 30-minute verification pass at the start of a phase saves multi-hour reworks later.
5. **Read the version from `package.json` at runtime.** Never hardcode it.
6. **Prune worktrees at session end.** Or note them in memory for next session.
7. **Renovate runs in the background.** Long-quiet branches need a fetch + rebase before push.
8. **`licensee` only scans the repo root.** Files inside `docs/` are invisible to GitHub's licence detection — that's both why moving licence-related FAQs there worked, and why duplicate detection failed.

---

*This document is updated only when a new incident teaches a new lesson. Keep it as a small set of high-signal entries — not a generic git tutorial.*
