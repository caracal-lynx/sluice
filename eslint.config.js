import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";

// Caracal Lynx shared lint config — DAG-158 pilot, authored in-repo before
// extraction to the published @caracal-lynx/eslint-config package. Implements
// the [LINT-01] rule set from standards/coding/typescript-standards.md.
export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**", "docs-site/**"] },

  // Type-aware base. Sluice splits its TS projects (tsconfig.json = src only,
  // tsconfig.test.json = src + tests), so projectService auto-discovery misses
  // the tests. List both projects explicitly. NB for the shared package: the
  // project wiring is repo-specific — the package defaults to projectService,
  // and a consumer with a split tsconfig overrides parserOptions like this.
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Config/build files (eslint.config.js, etc.) live outside the TS projects;
  // disable type-aware linting for them or the parser errors with "file not
  // found in any of the provided project(s)" when linted directly (e.g. by the
  // lefthook pre-commit job, which passes staged files to eslint one by one).
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },

  // [LINT-01] mandated rules.
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error", // [T-01]
      "@typescript-eslint/no-floating-promises": "error", // [CORE-04] / [A-01]
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // OFF pending DAG-10 (strict tsconfig flags). Under the current tsconfig
      // (noUncheckedIndexedAccess off), this rule false-positives on guards that
      // are runtime-necessary — e.g. `lenRow[0]?.mn` on a possibly-empty query
      // result. Re-enable to 'warn' once DAG-10 lands and the types are accurate.
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/prefer-readonly": "warn",
      // Pragmatic profile (DAG-158): keep the genuinely bug-catching checks
      // (nullable enums, `any`, objects/promises misused as booleans) but allow
      // idiomatic nullish-as-falsy on strings/numbers/booleans. Default options
      // are noise-heavy and add little bug-catching value. To be reflected in
      // the [LINT-01] standards amendment.
      "@typescript-eslint/strict-boolean-expressions": [
        "warn",
        {
          allowString: true,
          allowNumber: true,
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: true,
          allowNullableNumber: true,
        },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }], // [L-02]
      eqeqeq: ["error", "always"],
      "no-eval": "error", // [CORE-02]
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },

  // [L-02] CLI entry is the one place console output is user-facing.
  {
    files: ["src/cli.ts"],
    rules: { "no-console": "off" },
  },

  // [TEST-10] focused/disabled tests. Tests deliberately use loose typing
  // (fixtures, partial mocks, `as` shaping), so the type-aware "unsafe" family
  // and stringify/assertion checks are relaxed here — but no-floating-promises
  // stays on (a forgotten await in a test is a real bug). Design note for the
  // shared package: ship this as a dedicated `tests/**` override block.
  {
    files: ["tests/**/*.ts"],
    plugins: { vitest },
    rules: {
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",
      "@typescript-eslint/no-explicit-any": "off",
      // Test fixtures/stubs are async to match plugin signatures; require-await
      // adds no value here.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
