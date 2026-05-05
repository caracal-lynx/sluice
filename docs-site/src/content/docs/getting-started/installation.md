---
title: Installation
description: Install the Sluice CLI globally with npm and verify it runs.
---

Sluice is a Node.js CLI tool published to npm as [`@caracal-lynx/sluice`](https://www.npmjs.com/package/@caracal-lynx/sluice).

## Prerequisites

- **Node.js 24 LTS or newer.** Sluice depends on `@duckdb/node-api`, which targets the current Node ABI. Download from [nodejs.org](https://nodejs.org/).
- **A terminal.** Sluice is a CLI; there is no UI. On Windows the team uses PowerShell 7 on Windows Terminal — anything POSIX or PowerShell-compatible works.

Confirm your Node version:

```powershell
node --version
# → v24.x.x or newer
```

## Install globally

The recommended install for day-to-day use:

```powershell
npm install -g @caracal-lynx/sluice
```

Then verify the CLI is on your `PATH`:

```powershell
sluice --version
sluice --help
```

You should see the package version and a list of commands (`run`, `validate`, `profile`, `check`, `plugins`, `merge`).

## Install per-project

If you'd rather pin Sluice to a specific repo (recommended for client engagements where the version is locked alongside the pipeline YAML):

```powershell
npm install --save-dev @caracal-lynx/sluice
npx sluice --version
```

In that mode every command becomes `npx sluice <command>` instead of plain `sluice`.

## What you get

The `@caracal-lynx/sluice` npm package includes:

- The `sluice` CLI binary.
- Built-in source adapters for **MSSQL**, **PostgreSQL**, **CSV**, **XLSX**, and **REST**.
- Built-in target adapters for **CSV** and **PostgreSQL**.
- The full Data Quality and Transform engines.
- The plugin system (Tier 1 YAML composite rules, Tier 2 file plugins, Tier 3 npm packages).
- The DuckDB-backed staging layer.

ERP-specific target adapters (IFS, Business Central, BlueCherry), the Enrich service, country/region rule packages, and the MCP server are **paid add-ons** delivered via private npm packages — see [Commercial Support](/sluice/commercial-support/).

## Next step

You're ready to run your first pipeline. Head to the [Quickstart](/sluice/getting-started/quickstart/) — under ten minutes from here to a working CSV-to-CSV migration with data quality validation.
