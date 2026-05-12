# Security Policy

## Reporting a vulnerability

Email **security@caracallynx.com** with details. Please do not open a public
issue for security reports — give us a chance to fix the issue before it
becomes public.

When reporting, include where possible:

- A description of the issue and the impact you believe it has
- Steps to reproduce (the smallest pipeline YAML or code snippet that triggers
  the behaviour)
- The version of `@caracal-lynx/sluice` you're running, the Node version, and
  the OS
- Any mitigations you've already deployed locally

We aim to:

- Acknowledge within **48 hours**
- Provide a status update within **7 days**
- Publish a fix within **90 days** of the initial report (sooner where
  practicable)

We will credit you in the release notes for the fix unless you ask us not to.

## Supported versions

The current major version of `@caracal-lynx/sluice` receives security fixes.
Older majors do not. Security fixes are shipped as patch releases on the
current major.

## Scope

In scope:

- The open-source `@caracal-lynx/sluice` core package
- Built-in source / target adapters shipped with the public package
- The DQ engine, transform engine, merge engine, and config loader

Out of scope (these are private commercial packages — report directly to
**security@caracallynx.com** if you have access):

- `@caracal-lynx/sluice-enrich` and built-in enrich providers
- `@caracal-lynx/sluice-rules` and individual rule packages
- `@caracal-lynx/sluice-adapter-*` ERP adapter packages
- `@caracal-lynx/sluice-mcp` (MCP server)
- Per-client engagement repositories

## Out of scope (general)

- Issues in third-party dependencies — please report to the upstream project
  first; we'll track the upgrade
- Denial-of-service via deliberately malformed YAML configs (the operator
  controls what configs they run)
- Issues that require physical access to the operator's machine

— Caracal Lynx Limited
