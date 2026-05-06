# @caracal-lynx/sluice

## 0.2.0

### Minor Changes

- [#48](https://github.com/caracal-lynx/sluice/pull/48) [`d6d06a1`](https://github.com/caracal-lynx/sluice/commit/d6d06a134bd1466a2bb4df090b8bf6c4c3a54495) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Phase 4 prep — table-name plumbing for the enrich phase.

  The Phase 4a OSC scaffolding hardcoded `stg_raw` as the table the enrich runner
  operates on, but the multi-source pipeline runner invokes the enrich phase
  between `merge` (which produces `stg_merged`) and post-merge DQ. To make that
  work end-to-end without mutating `stg_merged` in place, the public surface now
  plumbs a `sourceTable` argument:
  - `EnrichPhaseFactory` gains a 6th parameter `sourceTable: string`. The
    open-source `PipelineRunner.runEnrich()` passes `'stg_raw'` for single-source
    pipelines; `MultiSourcePipelineRunner.runEnrich()` passes `'stg_merged'`.
  - The three Phase 4a `StagingStore` stubs (`selectDistinct`,
    `addColumnIfNotExists`, `batchUpdateColumns`) now take `table: string` as
    their first parameter. They still throw with the
    `install @caracal-lynx/sluice-enrich` message until the private package is
    installed and patches the prototype.
  - `Logger` (from pino) is now re-exported from the public barrel so downstream
    consumers can import the type via `@caracal-lynx/sluice` without taking a
    direct dependency on pino.
  - `EnrichError` is now re-exported alongside the other public error classes.
    It's already used internally by the CLI to map onto exit code 4, but
    downstream packages (notably `@caracal-lynx/sluice-enrich`) need to be able
    to throw an `instanceof EnrichError` for that mapping to fire — so it has to
    be reachable via the public path.

  The upcoming `@caracal-lynx/sluice-enrich@0.1.0` will require this version as
  its peer dependency lower bound.

## 0.1.3

### Patch Changes

- [#34](https://github.com/caracal-lynx/sluice/pull/34) [`3825f80`](https://github.com/caracal-lynx/sluice/commit/3825f80cf049496c54150285080d75bdefb28057) Thanks [@michaelscott-1963](https://github.com/michaelscott-1963)! - Update the paid-services contact email in README.md from a personal address to the dedicated `sluice@caracallynx.com` mailbox so commercial enquiries land in a routable inbox.
