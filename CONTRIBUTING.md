# Contributing to Sluice

Thanks for considering a contribution. Sluice is open-source under the Elastic
Licence 2.0; bug reports, feature requests, and PRs are all welcome under that
licence's terms.

## Reporting bugs

Use the [bug report issue template](.github/ISSUE_TEMPLATE/bug_report.yml).
Include the smallest pipeline YAML that reproduces the issue, the Sluice
version, your Node version, and the OS you're running on.

## Suggesting features

Use the [feature request issue template](.github/ISSUE_TEMPLATE/feature_request.yml).
Describe the use case, the proposed YAML or API shape, and whether you'd be
willing to send a PR.

## Submitting a PR

1. Fork the repository and create a feature branch from `master`. Branch naming
   conventions are documented in [docs/branching-strategy.md](docs/branching-strategy.md):
   short-lived `feat/`, `fix/`, `docs/`, `chore/`, or `hotfix/` branches, with
   the branch name forming the prefix of every commit message:
   `[<branch-name>] - <short summary>`.
2. Add tests for any new behaviour. Sluice maintains 80% line coverage in
   `src/dq/` and `src/transform/` — see [CLAUDE.md](CLAUDE.md) for the full
   testing conventions.
3. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`
   locally before opening the PR.
4. Add a `.changeset/` entry describing your change. Run `npm run changeset`,
   answer the prompts (patch / minor / major + a one-line summary), and commit
   the generated `.changeset/<random-name>.md` file alongside your code changes.
   Skip this step only for docs-only or CI-only PRs.
5. Sign off your commits with `git commit -s -m "..."`. By signing off you
   confirm the contribution is your own and that you agree it can be released
   under the Elastic Licence 2.0.

## Code style

- TypeScript strict mode. No `any`.
- All config types come from Zod inference — never write manual interfaces for
  anything that maps to pipeline YAML.
- Prefer dedicated functions over inline lambdas in hot paths.
- See [CLAUDE.md](CLAUDE.md) for the full conventions, including error handling,
  logging (`pino`, never `console.log`), and barrel-export rules.

## What gets accepted

- Bug fixes with a regression test ✅
- New rule / transform / merge / source / target plugins (Tier 2 or Tier 3) ✅
- Documentation improvements ✅
- Performance improvements with measurements ✅

## What needs a discussion first (open an issue)

- New top-level YAML keys
- New CLI commands or flags that change exit-code behaviour
- New core dependencies (anything outside MIT / Apache 2.0 / BSD / ISC)
- Changes to the public API surface in `src/index.ts`

## Commercial questions

For paid services — enrichment service, ERP adapters (IFS, Business Central,
BlueCherry), domain rule packages, the Sluice MCP server, or full migration
delivery — email **michael.scott@caracallynx.com**. These are not handled via
GitHub issues.

## Licence

By contributing, you agree that your contributions will be licensed under the
[Elastic Licence 2.0](LICENSE), the same licence as the rest of the project.
You also agree that Caracal Lynx Limited retains the right to include your
contribution in future releases, including any future commercial licences.

If you are unsure about anything, open an issue or email us before doing the
work — we'd rather discuss upfront than reject after.

— Caracal Lynx Limited
