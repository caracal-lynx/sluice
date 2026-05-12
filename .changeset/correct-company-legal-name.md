---
'@caracal-lynx/sluice': patch
---

📝 Correct company legal name in copyright headers and docs.

The legal entity registered with Companies House (SC826823) is **Caracal Lynx Limited**, not "Caracal Lynx Ltd.". An earlier sweep had standardised the codebase on the abbreviated form. This change corrects every copyright header, sign-off, `author` field in `package.json`, and prose reference across the repo (112 occurrences in 90 files) back to the legal name. No runtime behaviour changes — comments and metadata only.
