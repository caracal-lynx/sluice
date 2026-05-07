---
'@caracal-lynx/sluice': patch
---

🐛 Fix `sluice --version` reporting a stale hardcoded `0.1.0` regardless of installed version.

`src/cli.ts` previously called `program.version('0.1.0')` with a literal string that was set at first release and never updated. Every published version since (`0.1.1`, `0.1.2`, `0.1.3`, `0.2.0`) reported `0.1.0` when users ran `sluice --version`.

Now reads the version dynamically from the installed package's `package.json` at runtime, mirroring the pattern already used by `@caracal-lynx/sluice-enrich`'s CLI. Future releases will self-report correctly without anyone needing to remember to update a literal.
