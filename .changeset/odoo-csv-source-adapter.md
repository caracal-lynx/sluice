---
'@caracal-lynx/sluice': minor
---

✨ Add the `odoo-csv` source adapter for Odoo's product/customer/etc. CSV exports.

Odoo's CSV exports have one structural quirk the plain `csv` adapter
can't handle: products with multi-axis variants emit a "continuation
row" for every variant axis beyond the first, leaving every column blank
except the one carrying the `Key: value` cell (typically
`Variant Values`).

The new adapter merges continuation rows into their preceding parent and,
when `pivot:` is declared, splits each `Key: value` cell on the first
colon and routes the value into a new column named after the key.

```yaml
source:
  adapter: odoo-csv
  file: ./sources/odoo-products.csv
  pivot:
    column: "Variant Values"
    keys: [Size, "Colours Pioneer", COLOUR_YARN]
    onUnknownKey: warn      # warn (default) | error
    dropOriginal: true      # default true — drop the pivot column from output
```

Behaviour:

- **Continuation merge** is unambiguous: a row where every column except
  `pivot.column` is blank is treated as an additional `Key: value`
  contribution to the preceding parent row.
- **Output schema is stable**: declared `pivot.keys` are the only new
  columns. In `onUnknownKey: warn` mode, unknown keys are logged and
  dropped — they do not become output columns.
- **Same-key collision** inside one logical row (e.g. parent and
  continuation both contribute `Size:`) warns and last-wins.
- **Orphan continuation rows** (no preceding parent) abort the run with
  a clear `SourceError`.
- Without `pivot:`, the adapter behaves like the plain `csv` adapter —
  the brand reserves namespace for future Odoo-specific quirks
  (M2M-comma-joined cells, locale-aware dates/currencies) without
  bloating other adapters.

Backwards compatible. Existing pipelines are unaffected.
