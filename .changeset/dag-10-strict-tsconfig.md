---
"@caracal-lynx/sluice": patch
---

Enable the full `[C-01]` TypeScript strict baseline in `tsconfig.json`
(`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`,
`useUnknownInCatchVariables`, `noImplicitOverride`, and the rest) and fix the
resulting null-safety findings in the merge engine, the xlsx/bc adapters, and
the dq/prep/transform/staging modules. All fixes are behaviour-preserving
(real narrowing via destructuring/iterators — no `as`/`!`/`@ts-expect-error`).
(DAG-10)
