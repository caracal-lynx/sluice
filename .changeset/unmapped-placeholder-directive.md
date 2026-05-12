---
'@caracal-lynx/sluice': minor
---

✨ Add the `unmapped: true` field-mapping directive for iterative pipeline drafts.

When a field mapping declares `unmapped: true`, the transform engine emits
`transform.unmappedPlaceholder` (default `*** TBC ***`) for every row,
regardless of `from`, `type`, `cleanse`, or `max`. The directive lets a
draft pipeline run end-to-end before its source fields have been
identified, so client-facing output can be reviewed iteratively as
mappings are wired in.

```yaml
transform:
  unmappedPlaceholder: "*** TBC ***"   # optional override
  fields:
    - to: Division
      type: string
      unmapped: true                   # emits placeholder for every row
```

The Zod refinement on `FieldMappingSchema` that requires `from` for
source-reading types (`string`, `number`, `decimal`, `boolean`, `date`,
`lookup`, `concat`) is relaxed when `unmapped: true`. Existing pipelines
are unaffected — `unmapped` defaults to undefined.
