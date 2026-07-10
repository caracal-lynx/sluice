---
"@caracal-lynx/sluice": patch
---

Revert js-yaml to v4. v5 is ESM-only and drops the default export, which breaks a transitive default-import in the docs-site astro/starlight prerender path. Pinned to `<5` in Renovate until the docs toolchain supports v5.
