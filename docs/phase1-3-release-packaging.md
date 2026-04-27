# Sluice Release Packaging Draft

Date: 2026-04-19
Branch: master
Scope: Phase 1 through Phase 3 delivery state

## Current Repository State

- Working tree is clean.
- Latest commit on master: cd069a3
- Previous foundational commit: 3afe551

## Suggested Logical Commit Grouping (for changelog narrative)

Even though the branch is already committed, the delivered work can be communicated as four release groups:

1. Core ETL runtime foundation
- Staging store and schema helpers
- Source adapters (csv, mssql, pg, xlsx, rest)
- Target adapters (bc, ifs, bluecherry, csv, pg)
- DQ engine and built-in rules
- Transform engine and expression/cleanse flows
- Pipeline runner and CLI baseline
- CI workflow and broad unit/integration coverage

Primary reference commit: 3afe551

2. Multi-source configuration and schema expansion
- Pipeline schema support for source vs sources+merge forms
- Merge schema and field strategy schema
- Multi-source type guards
- Source-scoped DQ rule shape support

Primary reference commit: cd069a3

3. Multi-source execution and merge engine
- MultiSourcePipelineRunner orchestration
- Merge engine, SQL builder, conflict logging
- Built-in merge strategies: coalesce, priority-override, union, intersect
- Per-source rename support and source-scoped DQ flow
- Incremental-source state handling for multi-source runs

Primary reference commit: cd069a3

4. Plugin and CLI hardening plus documentation
- Plugin loader coverage for rule, transform, and merge strategy plugins
- CLI introspection commands for plugins and merge strategy discovery
- Additional examples and expanded plugin guide
- Test-suite expansion for runner wiring and merge behavior

Primary reference commit: cd069a3

## Release Notes Draft

### Summary

This release completes the ETL runtime foundation and adds first-class multi-source merge capability. Pipelines can now model complex entity assembly from multiple systems, merge records into golden rows using configurable strategies, and run source-scoped and post-merge quality checks with strong test coverage.

### Highlights

- Added a production-ready ETL core with staged extraction, quality validation, transformation, and target loading.
- Added multi-source pipeline schema and execution path.
- Added merge engine with four built-in strategies:
  - coalesce
  - priority-override
  - union
  - intersect
- Added conflict logging for merge disagreements and source rename support for header normalization.
- Expanded plugin support and discovery for custom DQ rules, transforms, and merge strategies.
- Added CLI introspection for plugins and merge strategy metadata.
- Added extensive unit and integration test coverage across config, runner, plugins, and merge flows.

### User-Facing Additions

- Multi-source pipeline definitions using sources plus merge.
- Merge strategy operations in CLI:
  - sluice merge list-strategies
  - sluice merge info <strategy>
- Plugin visibility command:
  - sluice plugins

### Compatibility and Risk

- Single-source pipelines remain supported.
- No intentional breaking change to baseline single-source behavior.
- Operational complexity increases for multi-source runs due to merge and conflict-resolution configuration; examples and plugin docs are included to reduce adoption risk.

### Validation Snapshot

- Full suite and build were green at final checkpoint before packaging:
  - tests passing
  - TypeScript build passing

### Included Documentation

- Expanded phase extension guidance
- Dedicated plugin guide
- Multi-source examples:
  - eribe-style-merge
  - erp-reconciliation
  - inventory-sync

## Suggested Tag and Title

- Suggested tag: v0.3.0
- Suggested release title: Multi-source Merge and Plugin-Driven ETL Hardening

## Optional Follow-up

- Split future work into smaller feature commits to simplify downstream cherry-picks.
- Add a top-level CHANGELOG.md if you want durable release notes inside the repo.
