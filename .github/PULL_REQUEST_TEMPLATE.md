<!--
Thanks for contributing to Sluice!

Branch naming: feat/, fix/, docs/, chore/, hotfix/.
Commit subject format: [<branch-name>] - <short summary>
-->

## Summary

<!-- What does this PR change, and why? 1-3 bullets. -->

-

## Type of change

<!-- Tick all that apply. -->

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (existing pipelines or plugin contracts must be updated)
- [ ] Documentation only
- [ ] Build / tooling / CI only

## Public-API impact

<!--
Sluice's public API is the surface exported from `src/index.ts` plus the YAML
config schema. Any change here is "public-API affecting".
-->

- [ ] No public-API changes
- [ ] Adds to the public API (backwards-compatible)
- [ ] Changes the public API (breaking — describe the migration below)

## Test plan

<!--
- New behaviour ⇒ new tests
- Bug fix ⇒ regression test
- Refactor ⇒ existing tests still pass

Paste the output of `npm test` if it's relevant.
-->

- [ ] `npm test` passes locally
- [ ] `npm run typecheck` clean
- [ ] `npm run typecheck:tsgo` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` clean

## Changeset

- [ ] I have added a `.changeset/` entry (`npm run changeset`)
- [ ] N/A — this is a docs-only or CI-only change, no version bump needed

<!--
Sluice releases via Changesets (https://github.com/changesets/changesets). Every PR that
changes `src/`, `dist/`, or the public API needs a changeset describing the change at
patch / minor / major level. Docs-only and CI-only PRs can skip the changeset.
-->

## Documentation

- [ ] [CLAUDE.md](../CLAUDE.md) updated if conventions or schema changed
- [ ] [README.md](../README.md) updated if user-visible behaviour changed
- [ ] [PLUGINS.md](../PLUGINS.md) updated if plugin authoring conventions changed
- [ ] N/A — no doc changes required

## Sign-off

- [ ] My commits are signed off (`git commit -s`)
- [ ] I agree my contribution is licensed under the [Elastic Licence 2.0](../LICENSE)
