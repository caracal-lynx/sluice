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
);
