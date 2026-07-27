import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

const resolve = {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
  },
};

/**
 * Two projects so the timeout budget matches what each suite actually does
 * (DAG-208).
 *
 * Unit tests keep vitest's 5s default: they are pure or in-memory, so anything
 * approaching 5s is hung rather than slow, and should fail fast.
 *
 * Integration tests stand up real DuckDB staging, write real files, and drive
 * the CLI. On the `windows-latest` runner they were measured at 60-110% of the
 * 5s default — `merges sources with composite primary keys` took 5531ms and
 * failed a release PR on timing alone, while its siblings passed at 724ms and
 * 3324ms. That is a coin flip, not a signal. 30s is deliberate headroom over
 * the slowest observed run, not a snug fit: a red here should mean broken,
 * never merely slow.
 *
 * `hookTimeout` matches — these suites do their DuckDB and fixture setup in
 * `beforeEach`, which carries the same 5s default and the same exposure.
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
          include: ["tests/unit/**/*.test.ts"],
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
