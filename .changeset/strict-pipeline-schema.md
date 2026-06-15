---
'@caracal-lynx/sluice': minor
---

Reject unknown top-level keys in `PipelineSchema`

The root pipeline object is now `.strict()`: any unrecognised top-level key (e.g. a
misspelled or unsupported section) is rejected with a clear Zod path instead of being
silently stripped. Previously a key such as `customChecks:` parsed with `valid: true`
and then vanished at runtime, masking authoring mistakes.

**Breaking:** pipelines that relied on extra top-level keys being ignored will now fail
validation. Move any such keys under a supported section or remove them. Nested objects
(`dq`, `transform`, `source`, `target`, …) are unaffected — only the top-level object is
strict.
