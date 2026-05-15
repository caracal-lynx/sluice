---
"@caracal-lynx/sluice": minor
---

Export `BUILTIN_CLEANSE_OPS` from the package root — an immutable, ordered array of `{ id, description, argSpec? }` records describing every built-in cleanse op accepted by `applyCleanse` (`trim`, `uppercase`, `lowercase`, `titleCase`, `stripNonAlpha`, `stripNonNumeric`, `stripWhitespace`, `nullIfEmpty`, `normaliseQuotes`, `normaliseUnicode`, `padStart`, `padEnd`, `truncate`). Lets external tooling — `@caracal-lynx/sluice-mcp`'s `list_transform_ops` tool, doc generators, IDE autocomplete helpers — enumerate the supported ops without duplicating the list. The corresponding `BuiltinCleanseOpInfo` type is also exported.
