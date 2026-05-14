---
"@caracal-lynx/sluice": patch
---

**Security**: replace `expr-eval@2.0.2` with `expr-eval-fork@^3.0.3` to remediate two HIGH severity vulnerabilities ([GHSA-rpw9-cf2g-5q7g](https://github.com/advisories/GHSA-rpw9-cf2g-5q7g) prototype pollution and the unrestricted function-evaluation advisory). The fork is a community-maintained drop-in replacement — same Parser API, same expression syntax — that ships the patches the original maintainer never released to npm.

No user-visible behaviour change: pipeline YAML files using `type: expression` continue to work without modification.
