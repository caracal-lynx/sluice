import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

const resolve = {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
  },
};

/**
 * Two projects so the timeout budget matches what each suite actually does
 * (DAG-208, extended fleet-wide by DAG-236).
 *
 * Unit keeps vitest's 5s default: these are pure or in-memory, so anything
 * approaching 5s is hung rather than slow and should fail fast. Do NOT raise
 * this to make a slow suite pass — move the suite to tests/integration/.
 *
 * Integration gets 30s for BOTH testTimeout and hookTimeout. The two CI
 * failures that prompted this were timeouts, not assertions, and both did
 * their filesystem work in `beforeEach` — so hookTimeout matters as much as
 * testTimeout. 30s is deliberate headroom over the slowest observed run, not a
 * snug fit: a red here should mean broken, never merely slow.
 *
 * The unit project EXCLUDES tests/integration/ rather than including a fixed
 * list of directories. A new test directory is then covered by unit
 * automatically; with an include-list it would silently run nowhere.
 */
const INTEGRATION_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    globals: false,
    projects: [
      {
        resolve,
        test: {
          name: "unit",
          globals: false,
          include: ["tests/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "tests/integration/**"],
        },
      },
      {
        resolve,
        test: {
          name: "integration",
          globals: false,
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: INTEGRATION_TIMEOUT_MS,
          hookTimeout: INTEGRATION_TIMEOUT_MS,
        },
      },
    ],
  },
  resolve,
});
