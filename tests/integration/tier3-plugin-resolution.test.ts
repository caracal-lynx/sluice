// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * DAG-361: Tier 3 plugin packages must resolve from the CLIENT PROJECT, i.e.
 * the directory holding `sluice.config.yaml`, not from wherever sluice itself
 * is installed.
 *
 * PLUGINS.md's only documented topology is: `npm install` the plugin in the
 * project next to `sluice.config.yaml`, run a (typically global) `sluice`.
 * The loader used a bare `import(entry.package)`, which Node resolves relative
 * to `dist/plugins/loader.js`, so that topology failed with
 * ERR_MODULE_NOT_FOUND and exit 3. The rule packs' own tests call
 * `plugin.register()` in-process and the older CLI plugin test colocates its
 * fixture with the test file, so nothing exercised the real layout.
 *
 * This suite reproduces it end to end: a project under os.tmpdir() (outside
 * sluice's own node_modules tree, so the old lookup cannot stumble on it), an
 * npm-install-shaped package in `<project>/node_modules`, and the BUILT CLI
 * run with cwd = the project. `pnpm test`/`test:cov` at the root build first.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";

import { RuleRegistry, TransformRegistry, loadNpmPlugins } from "../../src/plugins/index.js";
import { ConfigError } from "../../src/utils/errors.js";

const execFileAsync = promisify(execFile);

const CLI = path.resolve(import.meta.dirname, "../../dist/cli.js");

/**
 * Every test here spawns the real CLI, which imports the whole toolkit (duckdb,
 * mssql, pg, ...) before doing anything. That is ~2s on an idle machine, but
 * with the rest of the suite running in parallel a cold start was measured at
 * 15-30s on Windows, and the two-spawn tests hit the integration project's 30s
 * budget. The budget below is sized for spawning, not for a hang: each child
 * is killed at CHILD_TIMEOUT_MS, so a stuck CLI still fails the test.
 */
const CHILD_TIMEOUT_MS = 45_000;
const TEST_TIMEOUT_MS = 2 * CHILD_TIMEOUT_MS + 10_000;

let project = "";

/** A plugin module in PLUGINS.md's shape: `export const plugin = { register() }`. */
function pluginSource(ruleId: string): string {
  return `
export const plugin = {
  register(rules) {
    rules.register({
      id: ${JSON.stringify(ruleId)},
      validate(value, config, rowIndex, field) {
        if (value === null || value === undefined || value === "") return null;
        return String(value).length % 2 === 0
          ? null
          : { field, rowIndex, value, rule: ${JSON.stringify(ruleId)}, severity: config.severity,
              message: field + " must have an even number of characters" };
      },
    });
  },
};
`;
}

/** Write a package as `npm install` would lay it out, returning its directory. */
async function installPackage(
  root: string,
  name: string,
  ruleId: string,
  manifest: Record<string, unknown>,
  entry: string,
): Promise<string> {
  const dir = path.join(root, ...name.split("/"));
  await fs.mkdir(path.dirname(path.join(dir, entry)), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        type: "module",
        peerDependencies: { "@caracal-lynx/sluice": "*" },
        ...manifest,
      },
      null,
      2,
    ),
    "utf-8",
  );
  await fs.writeFile(path.join(dir, entry), pluginSource(ruleId), "utf-8");
  return dir;
}

async function writeProject(checkType: string, packages: string[]): Promise<void> {
  const p = (f: string): string => path.join(project, f).split(path.sep).join("/");
  await fs.writeFile(path.join(project, "in.csv"), "code\nodd\neven\n", "utf-8");
  await fs.writeFile(
    path.join(project, "p.pipeline.yaml"),
    `
pipeline:
  name: tier3-resolution
  client: test
  version: "1.0"
  entity: Thing
source:
  adapter: csv
  file: ${p("in.csv")}
dq:
  stopOnCritical: false
  rules:
    - field: code
      checks:
        - type: ${checkType}
          severity: warning
transform:
  fields:
    - from: code
      to: Code
      type: string
target:
  adapter: csv
  output: ${p("out.csv")}
run:
  outputDir: ${p("out")}
`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(project, "sluice.config.yaml"),
    `version: "1.0"\nplugins:\n${packages.map((pkg) => `  - package: ${JSON.stringify(pkg)}\n`).join("")}`,
    "utf-8",
  );
}

interface CliResult {
  code: number;
  output: string;
}

async function sluice(...args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      cwd: project,
      env: { ...process.env, NO_COLOR: "1" },
      timeout: CHILD_TIMEOUT_MS,
    });
    return { code: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : -1, output: `${e.stdout}${e.stderr}` };
  }
}

describe(
  "Tier 3 plugin packages resolve from the config directory (DAG-361)",
  { timeout: TEST_TIMEOUT_MS },
  () => {
    beforeAll(() => {
      // Fail loudly rather than skip: a skipped test here is the gap DAG-361 was.
      if (!existsSync(CLI)) {
        throw new Error(
          `${CLI} not found — build sluice first (pnpm --filter @caracal-lynx/sluice build)`,
        );
      }
    });

    beforeEach(async () => {
      project = await fs.mkdtemp(path.join(tmpdir(), "sluice-dag361-"));
    });

    afterEach(async () => {
      // Retries: Windows can briefly hold the directory after a child exits (EBUSY).
      await fs.rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });

    it("loads a package npm-installed next to sluice.config.yaml (PLUGINS.md shape: main)", async () => {
      await installPackage(
        path.join(project, "node_modules"),
        "@acme/sluice-rules-even",
        "acmeEvenLength",
        { main: "dist/index.js", types: "dist/index.d.ts" },
        "dist/index.js",
      );
      await writeProject("acmeEvenLength", ["@acme/sluice-rules-even"]);

      const check = await sluice("check", "p.pipeline.yaml");
      expect(check.output).not.toMatch(/ERR_MODULE_NOT_FOUND/);
      expect(check.output).toMatch(/config is valid/);
      expect(check.code).toBe(0);

      const plugins = await sluice("plugins");
      expect(plugins.code).toBe(0);
      expect(plugins.output).toMatch(/acmeEvenLength/);
    });

    it("loads an ESM-only package whose exports map has only an import condition", async () => {
      // createRequire().resolve() would reject this with ERR_PACKAGE_PATH_NOT_EXPORTED:
      // require resolution uses the "require" condition.
      await installPackage(
        path.join(project, "node_modules"),
        "esm-only-rules",
        "esmOnlyEven",
        { exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } },
        "dist/index.js",
      );
      await writeProject("esmOnlyEven", ["esm-only-rules"]);

      const check = await sluice("check", "p.pipeline.yaml");
      expect(check.output).toMatch(/config is valid/);
      expect(check.code).toBe(0);
    });

    it("resolves a relative file path against the config directory, not the cwd of sluice", async () => {
      const dir = path.join(project, "local-plugins", "pack");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "index.js"), pluginSource("relativeEven"), "utf-8");
      await writeProject("relativeEven", ["./local-plugins/pack/index.js"]);

      const check = await sluice("check", "p.pipeline.yaml");
      expect(check.output).toMatch(/config is valid/);
      expect(check.code).toBe(0);
    });

    it("accepts an absolute path (a drive-letter path on Windows)", async () => {
      const entry = path.join(project, "abs-plugin.js");
      await fs.writeFile(entry, pluginSource("absoluteEven"), "utf-8");
      await writeProject("absoluteEven", [entry]);

      const check = await sluice("check", "p.pipeline.yaml");
      expect(check.output).toMatch(/config is valid/);
      expect(check.code).toBe(0);
    });

    it("reports a missing relative path against the config directory", async () => {
      await writeProject("relativeEven", ["./nope/index.js"]);

      const check = await sluice("check", "p.pipeline.yaml");
      expect(check.code).toBe(3);
      expect(check.output).toMatch(/relative plugin paths resolve against/);
    });

    it("resolves a relative path to a package directory via its manifest", async () => {
      await installPackage(
        path.join(project, "vendor"),
        "dir-rules",
        "dirEven",
        { exports: { ".": { import: "./lib/main.js" } } },
        "lib/main.js",
      );
      await installPackage(
        path.join(project, "vendor"),
        "dir-rules-main",
        "dirMainEven",
        { main: "lib/main.js" },
        "lib/main.js",
      );
      await writeProject("dirEven", ["./vendor/dir-rules", "./vendor/dir-rules-main"]);

      const check = await sluice("check", "p.pipeline.yaml");
      expect(check.output).toMatch(/config is valid/);
      expect(check.code).toBe(0);

      const plugins = await sluice("plugins");
      expect(plugins.output).toMatch(/dirEven/);
      expect(plugins.output).toMatch(/dirMainEven/);
    });

    it("falls back to sluice's own install location when the project cannot see the package", async () => {
      // js-yaml is a sluice dependency, so it resolves only from sluice's side. It
      // is not a plugin, so reaching the register() check proves it RESOLVED —
      // the topology of a plugin installed globally alongside a global sluice.
      await writeProject("acmeEvenLength", ["js-yaml"]);

      const check = await sluice("check", "p.pipeline.yaml");
      expect(check.code).toBe(3);
      expect(check.output).toMatch(/must export plugin\.register\(\)/);
      expect(check.output).not.toMatch(/Cannot find package/);
    });

    it("fails with exit 3 and says where it looked when the package is not installed", async () => {
      await writeProject("acmeEvenLength", ["@acme/not-installed"]);

      const check = await sluice("check", "p.pipeline.yaml");
      expect(check.code).toBe(3);
      expect(check.output).toMatch(/@acme\/not-installed/);
      // Names the project directory it searched. Matched on the unique mkdtemp
      // basename: Windows may report the same directory in 8.3 or long form.
      // Quotes arrive backslash-escaped: the CLI logs the error as JSON.
      expect(check.output).toMatch(/Cannot find package \\?"@acme\/not-installed\\?" from /);
      expect(check.output).toContain(path.basename(project));
      expect(check.output).toMatch(/npm install @acme\/not-installed/);
    });
  },
);

/**
 * The same resolution paths in-process. The CLI suite above is the proof of the
 * real topology; this one is what coverage can see (v8 does not follow the
 * spawned children), and it pins the registry contents directly.
 */
describe("loadNpmPlugins resolution, in-process (DAG-361)", () => {
  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(tmpdir(), "sluice-dag361-inproc-"));
  });

  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  async function load(packages: string[]): Promise<string[]> {
    await writeProject("unused", packages);
    const rules = new RuleRegistry();
    await loadNpmPlugins(path.join(project, "sluice.config.yaml"), rules, new TransformRegistry());
    return rules.list();
  }

  it("registers rules from every supported specifier shape", async () => {
    const nm = path.join(project, "node_modules");
    await installPackage(
      nm,
      "@acme/main-shape",
      "ipMain",
      { main: "dist/index.js" },
      "dist/index.js",
    );
    await installPackage(
      nm,
      "esm-only",
      "ipEsm",
      { exports: { ".": { import: "./i.js" } } },
      "i.js",
    );
    const vendor = path.join(project, "vendor");
    await installPackage(vendor, "ex", "ipDirExports", { exports: "./lib.js" }, "lib.js");
    await installPackage(vendor, "mn", "ipDirMain", { main: "lib.js" }, "lib.js");
    await fs.writeFile(path.join(project, "file.js"), pluginSource("ipFile"), "utf-8");
    await fs.writeFile(path.join(project, "abs.js"), pluginSource("ipAbs"), "utf-8");

    const ids = await load([
      "@acme/main-shape",
      "esm-only",
      "./vendor/ex",
      "./vendor/mn",
      "./file.js",
      path.join(project, "abs.js"),
    ]);

    expect(ids).toEqual(
      expect.arrayContaining(["ipMain", "ipEsm", "ipDirExports", "ipDirMain", "ipFile", "ipAbs"]),
    );
  });

  it("falls back to sluice's own location (resolves js-yaml, which is not a plugin)", async () => {
    await expect(load(["js-yaml"])).rejects.toThrow(/must export plugin\.register\(\)/);
  });

  it("names the config directory when a package is not installed", async () => {
    const err = await load(["@acme/absent"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(String(err)).toMatch(/Cannot find package "@acme\/absent" from /);
    expect(String(err)).toContain(path.basename(project));
  });

  it("reports a missing path against the config directory", async () => {
    await expect(load(["./missing.js"])).rejects.toThrow(/relative plugin paths resolve against/);
  });

  it("does not mask a package that exists but exports nothing for import", async () => {
    // Found in the project, so no fallback: the real cause must surface.
    await installPackage(
      path.join(project, "node_modules"),
      "require-only",
      "never",
      { exports: { ".": { require: "./i.js" } } },
      "i.js",
    );
    await expect(load(["require-only"])).rejects.toThrow(
      /ERR_PACKAGE_PATH_NOT_EXPORTED|No "exports"/,
    );
  });
});
