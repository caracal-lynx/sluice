# Contributing to Sluice

**This repository is a read-only release mirror.** Sluice is developed in a
private monorepo; what you see here is published from it at each release. The
mirror exists so the source of a released version is public and auditable under
the [Elastic Licence 2.0](LICENSE).

Two consequences, stated plainly:

- **Pull requests cannot be accepted.** Anything opened here has nowhere to
  merge to — the mirror is overwritten by the next release. This is not a
  judgement on the change; there is simply no path from this repository into
  the one the code is built from.
- **A clone of this repository will not install.** `packages/sluice`'s manifest
  carries `catalog:` specifiers that resolve against a workspace file which
  lives in the monorepo, not here. `pnpm install` fails with
  `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`. Installing the published package
  from npm is unaffected — those specifiers are rewritten at publish time.

## What is welcome

**Issues.** Bug reports and feature requests are read and acted on, and the
work happens upstream in the private monorepo.

- [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml) — include the smallest
  pipeline YAML that reproduces the issue, the Sluice version, your Node
  version, and the OS.
- [Feature request](.github/ISSUE_TEMPLATE/feature_request.yml) — describe the
  use case and the proposed YAML or API shape.
- [Discussions](https://github.com/caracal-lynx/sluice/discussions) for general
  questions and "how do I…?".

**Security reports** go to **security@caracallynx.com**, never to a public
issue — see [SECURITY.md](SECURITY.md) for the disclosure process and
timelines.

**Commercial enquiries** — enrichment service, ERP adapters (IFS, Business
Central, BlueCherry), domain rule packages, the Sluice MCP server, or migration
delivery — email **sluice@caracallynx.com**. These are not handled via GitHub
issues.

## If you want to contribute code

Open an issue describing what you want to change and why. If it is something we
want, it gets built upstream and credited in the release notes. There has never
been an external code contributor, so there is no fork-and-PR workflow to
maintain and we are not going to pretend otherwise.

## Licence

Sluice is licensed under the [Elastic Licence 2.0](LICENSE). See the
[Licensing FAQ](docs/licensing-faq.md) for a plain-English guide to what the
licence permits.

— Caracal Lynx Limited
