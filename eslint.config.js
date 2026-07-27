import tseslint from "typescript-eslint";
import caracal from "@caracal-lynx/eslint-config";

// Caracal Lynx shared lint config ([LINT-01]/[LINT-02]) consumed from the
// published @caracal-lynx/eslint-config package (DAG-159 fleet rollout). The
// full rule set now lives in the package; only Sluice-specific deltas remain:
//
//  1. Ignore the Astro docs-site (not a TS source tree the base config covers).
//  2. Split tsconfig: tsconfig.json = src, tsconfig.test.json = src + tests, so
//     projectService auto-discovery misses the tests — switch to explicit
//     projects. (Per the package's documented split-tsconfig recipe.)
export default tseslint.config(
  ...caracal,

  { ignores: ["docs-site/**"] },

  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["./tsconfig.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // 3. Root config files belong to no tsconfig project (tsconfig.json includes
  //    only src, tsconfig.test.json only src + tests), so type-aware rules
  //    cannot parse them: "was not found by the project service".
  //
  //    `pnpm lint` hides this — it runs `eslint src tests` and never touches
  //    them. lefthook's pre-commit lints *staged files individually*, so any
  //    commit touching vitest.config.ts failed while CI stayed green. Disabling
  //    type-aware rules for these files is the documented fix; they get the
  //    syntactic rules, which is all a config file needs.
  {
    files: ["*.config.ts", "*.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
