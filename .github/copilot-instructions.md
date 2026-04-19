# Copilot Code Review Instructions — Sluice

Sluice is a config-driven ETL toolkit (TypeScript + Node.js) that uses DuckDB
for staging and YAML-defined pipelines, targeting ERP systems such as IFS,
Microsoft Dynamics 365 Business Central, and BlueCherry. Code reviews should
optimise for **data safety, determinism, and clear failure modes** — an ETL
tool that silently corrupts data is worse than one that refuses to start.

Save this file as `.github/copilot-instructions.md` in the repository root.

---

## General code quality

- Flag any exported function longer than 60 lines or with cyclomatic complexity greater than 10.
- Flag `TODO`, `FIXME`, or `XXX` comments that do not reference a GitHub issue number.
- Flag functions with more than three positional parameters; suggest an options object.
- Flag commented-out code blocks; they should be deleted or tracked in an issue.
- Flag files named `utils.ts`, `helpers.ts`, or `misc.ts` — push back on the lack of domain-specific naming.
- Flag magic numbers and unnamed string literals used as enum-style values; require a named constant or union type.

## TypeScript

- Flag any use of `any`, `as any`, `as unknown as`, `@ts-ignore`, or `@ts-expect-error` without an adjacent comment explaining why the escape hatch is necessary.
- Flag non-null assertions (`!`) on values that could plausibly be `undefined` at runtime.
- Require explicit return types on all exported functions and on any function longer than 10 lines.
- Flag unawaited promises, floating promises, and `async` functions that never `await`.
- Flag `Promise.all` over arrays of unknown length without a concurrency limit (e.g. `p-limit`).
- Prefer `readonly` arrays and `as const` for literal configuration objects.
- Flag `==` in favour of `===`; flag truthy checks on numeric values that could legitimately be `0` (e.g. row counts, offsets).
- Flag imports from deep paths of internal modules that bypass a package's public `index.ts`.

## DuckDB and data pipelines

- Flag any SQL built by string concatenation or by template literals that interpolate user, config, or source-data input; require parameterised queries.
- Flag raw SQL that lacks a corresponding integration test against a fixture DuckDB database.
- Flag bulk inserts or `COPY` operations that do not wrap the batch in a transaction.
- Flag schema changes (`CREATE`, `DROP`, `ALTER`) emitted outside of a dedicated migration module.
- Flag row-by-row processing in TypeScript where a set-based SQL operation would suffice.
- Require explicit handling of `NULL`, empty string, and whitespace-only values in transformations — silent coercion is a bug, not a feature.
- Flag pipelines that do not log source row count, target row count, and reject row count at the end of each stage.
- Flag the use of `SELECT *` in production queries; require explicit column lists.

## YAML pipeline configuration

- Flag YAML loading that does not validate the parsed object against a Zod (or equivalent) schema before use.
- Require that every pipeline YAML field either have a documented default or be explicitly marked required in the schema.
- Flag hard-coded file paths, connection strings, credentials, tenant IDs, or API keys inside YAML files — these belong in environment variables or a secrets provider.
- Flag duplicate keys, unused YAML anchors, and tab characters in YAML files.
- Flag pipeline definitions that reference a source or sink not declared in the top-level connections block.

## ERP target safety (IFS, Business Central, BlueCherry)

- Flag any code that writes to an ERP target without an explicit `dryRun` mode and an idempotency key or natural-key existence check.
- Flag retry logic that lacks exponential backoff and a maximum retry count.
- Flag HTTP calls without an explicit timeout.
- Flag parsing of ERP responses that does not handle the documented error envelope (for Business Central, the OData error object; for IFS, the standard fault structure).
- Flag hard-coded endpoint URLs; require them to be resolved from configuration per environment.
- Flag writes to ERP targets from within a `map`/`forEach` loop without a concurrency control.

## Logging, errors, observability

- Flag `console.log` / `console.error` outside of CLI entry points; require a structured logger (e.g. pino, winston).
- Flag `catch` blocks that swallow errors without logging and without either rethrowing or returning an explicit failure result.
- Flag log statements that include secrets, full connection strings, bearer tokens, or raw row payloads with potential PII.
- Require that pipeline failures emit a machine-readable summary including pipeline name, stage, source/target row counts, and error classification.
- Flag `throw new Error("...")` with a generic message where a typed error class would communicate intent (e.g. `ConfigValidationError`, `SourceConnectionError`, `TargetWriteError`).

## Testing

- Flag new modules under `src/` that do not have a corresponding test file in `tests/` or `__tests__/`.
- Flag tests whose only assertion is that no error was thrown; require behavioural assertions on outputs or side effects.
- Flag `.skip` or `.only` calls left in committed test code.
- Require that data-transformation tests include at least one null-input and one edge-case (empty string, boundary number, unicode) case.
- Flag mocks of DuckDB — use a real in-memory DuckDB instance with fixture data instead.

## What NOT to comment on

- Do not comment on formatting, import ordering, semicolons, or quote style — Prettier handles these.
- Do not suggest renaming variables purely for stylistic preference.
- Do not suggest adding JSDoc to internal, non-exported functions unless their behaviour is genuinely non-obvious.
- Do not suggest switching between `function` declarations and arrow functions as a style preference.
- Do not repeat feedback already covered by ESLint rules configured in the repository.
