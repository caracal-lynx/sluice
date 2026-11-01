import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * loadEnv must not write anything itself. stdout carries the progress
 * reporter's output (and must stay empty under `--silent`); stderr carries
 * pino's NDJSON log stream, so a stray plain-text line there breaks anyone
 * piping it to `jq` or `pino-pretty` (DAG-362).
 */
describe("loadEnv output", () => {
  let dir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  // vitest replaces the global console, so console.log/console.error (which
  // dotenv uses) never reach process.stdout/stderr.write inside a test worker.
  // Spy on both layers.
  let consoleSpies: ReturnType<typeof vi.spyOn>[];
  const keys = ["SLUICE_ENV_TEST_A", "SLUICE_ENV_TEST_B"];
  const savedDotenv: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sluice-env-"));
    fs.writeFileSync(path.join(dir, ".env"), "SLUICE_ENV_TEST_A=alpha\nSLUICE_ENV_TEST_B=beta\n");
    // dotenv 18 reads DOTENV_* settings from the ambient environment; clear
    // them so a developer's shell cannot change what this test observes.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("DOTENV_")) {
        savedDotenv[k] = process.env[k];
        delete process.env[k];
      }
    }
    vi.resetModules();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    for (const spy of consoleSpies) spy.mockRestore();
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(savedDotenv)) {
      if (v !== undefined) process.env[k] = v;
      delete savedDotenv[k];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function expectSilent(): void {
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  }

  it("loads an explicit --env file without writing to stdout or stderr", async () => {
    const { loadEnv } = await import("../../../src/utils/env.js");
    loadEnv(path.join(dir, ".env"));

    expect(process.env["SLUICE_ENV_TEST_A"]).toBe("alpha");
    expect(process.env["SLUICE_ENV_TEST_B"]).toBe("beta");
    expectSilent();
  });

  it("loads ./.env by default without writing to stdout or stderr", async () => {
    // dotenv resolves the default ./.env against process.cwd(). Stub it rather
    // than chdir, which vitest's worker threads do not support.
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const { loadEnv } = await import("../../../src/utils/env.js");
      loadEnv();
    } finally {
      cwdSpy.mockRestore();
    }

    expect(process.env["SLUICE_ENV_TEST_A"]).toBe("alpha");
    expectSilent();
  });
});
