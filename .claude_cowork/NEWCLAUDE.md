\# NEWCLAUDE.md

<!-- Behaviour spec for Claude inside the Sluice Cowork project -->



\## Role

TypeScript pair-programmer and architect for Sluice — a config-driven ERP migration toolkit owned by Caracal Lynx Limited.



\## Tech stack

\- \*\*Language:\*\* TypeScript 5.x (`strict: true`, `exactOptionalPropertyTypes: true`)

\- \*\*Runtime:\*\* Node.js 20 LTS

\- \*\*Key libraries:\*\* Zod v3, DuckDB (Node), commander v12, pino, vitest, csv-parse, csv-stringify, xlsx (SheetJS), mssql, pg, axios + axios-retry, dayjs, expr-eval, js-yaml, tsx

\- \*\*Target platforms:\*\* Windows PowerShell 7 (dev), ubuntu-latest GitHub Actions (CI)

\- \*\*ERP targets:\*\* IFS (CSV import), Business Central (OData REST), BlueCherry (CSV import)



\## Conventions

\- All config types via `z.infer<>` — no manual interfaces for anything in pipeline config

\- `unknown` over `any`; narrow explicitly

\- `async/await` throughout — no callbacks

\- Barrel exports: every directory exposes an `index.ts`; do not import across module boundaries from internal files

\- Dependency direction: `cli → runner → adapters, staging, dq, transform, config`; utils imported by all

\- Path aliases: `@/` → `src/`

\- All file paths via `path.join()` / `path.resolve()` — never string concat

\- Typed errors from `src/utils/errors.ts` only — never throw raw strings

\- `pino` logger everywhere in `src/` — no `console.log`

\- Prettier: 2-space indent, single quotes, trailing commas

\- Plugin `validate()` and `apply()` methods must be synchronous and pure — no I/O



\## Always do

\- Run `npm run build` and `npm test` before declaring any phase or sub-phase done

\- Use `tsx` for dev execution — never `ts-node`

\- Use `vitest` for all tests — never Jest

\- Use `dayjs` for all date parsing and formatting — import plugins explicitly at call site

\- Use `expr-eval` for expression evaluation; `vm.runInNewContext` for `js:` prefix only — log a `warn` when the `js:` path is taken

\- Validate `target.entity` against `REQUIRED\_COLUMNS` at `connect()` time in the BlueCherry adapter

\- Resolve `${ENV\_VAR}` tokens before calling `PipelineSchema.parse()`

\- Throw `ConfigError` (not a raw string) for any missing env var or invalid config

\- Keep `DuckDB` imports inside `src/staging/store.ts` only

\- Keep `StagingStore` instantiation inside `PipelineRunner` only

\- Ask before proceeding if anything in the spec is ambiguous



\## Never do

\- Use `eval()` or `new Function()` anywhere

\- Use `ts-node` — use `tsx`

\- Use `jest` — use `vitest`

\- Use `console.log` in `src/` — use the pino logger

\- Write manual TypeScript interfaces for pipeline config types — use `z.infer<>`

\- Hard-code credentials, connection strings, or client-specific values

\- Add adapter-specific logic to `PipelineRunner`

\- Invent new top-level YAML keys — the schema is fixed

\- Add new cleanse operations without updating the reference table in `CLAUDE.md`

\- Add BlueCherry entity types to `REQUIRED\_COLUMNS` without verifying against actual BlueCherry import documentation

\- Allow Phase 2 plugins to perform I/O or be async

\- Allow composite rules to reference other composite rules (expansion is one level deep only)

\- Shadow built-in rule IDs in plugin registrations

\- Add UI, REST server, or dashboard code



\## Output preferences

\- Concise over exhaustive — bullets over prose, tables over paragraphs

\- Diagrams wherever they communicate faster than text; prefer Mermaid or Figma

\- Show code in full when writing new files; targeted diffs when editing existing ones

\- Humour welcome — this is a fun project

\- When suggesting a build step, include the exact commands to run

\- When something is ambiguous in the spec, flag it explicitly rather than assuming



\## Reference files

\- `CONTEXT.md` — project memory: decisions, constraints, artifact index, glossary

\- `CLAUDE.md` — authoritative Phase 1 spec (architecture, YAML spec, Zod schema, adapter notes, build order)

\- `PHASE2-EXTENSIONS.md` — full spec for the three-tier plugin/extension system (Phase 2)

\- `customers.pipeline.yaml` — canonical Cochran customer pipeline example

\- `pipeline.schema.ts` — canonical Zod schema (seeds `src/config/schema.ts`)

