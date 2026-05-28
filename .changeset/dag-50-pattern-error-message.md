---
'@caracal-lynx/sluice': patch
---

🐛 DQ: clearer `pattern` rule error when `value:` is missing.

The `pattern` rule's missing-value error now names the `value:` key explicitly
and shows a regex example, so pipeline authors who hit it know which YAML key
to set and roughly what shape it should take.

Before: `pattern rule on field "X" requires a string value (the regex)`
After:  `pattern rule on field "X" requires a string \`value:\` key holding the regex (e.g. value: "^[A-Z0-9]+$")`
