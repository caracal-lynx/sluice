// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Sluice — plugin loader
 * @caracal-lynx/sluice
 *
 * Tier 2: discovers *.rule.{ts,js} and *.transform.{ts,js} files from a
 * plugins directory and registers them with the provided registries.
 *
 * Tier 3: reads sluice.config.yaml, imports declared npm packages, and
 * calls each package's register() function. Packages resolve from the
 * directory holding sluice.config.yaml (the client project), not from where
 * sluice itself is installed (DAG-361).
 *
 * Neither function throws if the directory / config file does not exist —
 * both are optional for any given project.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolve as esmResolve } from "import-meta-resolve";
import { load as yamlLoad } from "js-yaml";

import { ToolkitConfigSchema } from "../config/schema.js";
import type { MergeStrategyRegistry } from "../merge/index.js";
import type { MergeStrategyPlugin } from "../merge/types.js";
import { ConfigError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { RulePlugin, TransformPlugin } from "./types.js";
import type { RuleRegistry, TransformRegistry } from "./registry.js";

// ── Internal helpers ──────────────────────────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursively list all files under `dir` whose name ends with one of the
 * given `suffixes`, returning absolute paths.
 */
async function findFiles(dir: string, suffixes: readonly string[]): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true });
  return entries
    .filter((e) => suffixes.some((s) => e.endsWith(s)))
    .map((e) => path.resolve(path.join(dir, e)));
}

// ── Tier 2: file-based plugins ────────────────────────────────────────────────

/**
 * Scan `pluginDir` for `*.rule.{ts,js}` and `*.transform.{ts,js}` files,
 * import each one, and register the exported `rule` / `transform` with the
 * supplied registries.
 *
 * Silently returns if `pluginDir` does not exist.
 * Throws `ConfigError` if a file is found but does not export a valid plugin.
 */
export async function loadPlugins(
  pluginDir: string,
  rules: RuleRegistry,
  transforms: TransformRegistry,
  mergeStrategies?: typeof MergeStrategyRegistry,
): Promise<void> {
  if (!(await dirExists(pluginDir))) return;

  const ruleFiles = await findFiles(pluginDir, [".rule.ts", ".rule.js"]);
  for (const file of ruleFiles) {
    try {
      const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      const plugin = mod["rule"] as RulePlugin | undefined;
      if (typeof plugin?.id !== "string" || typeof plugin.validate !== "function") {
        throw new Error(
          "Plugin file must export: export const rule: RulePlugin with id and validate()",
        );
      }
      rules.register(plugin);
      logger.debug({ pluginId: plugin.id, file }, "Registered rule plugin");
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ConfigError(
        `Failed to load rule plugin "${path.basename(file)}": ${String(err)}`,
        err,
      );
    }
  }

  const transformFiles = await findFiles(pluginDir, [".transform.ts", ".transform.js"]);
  for (const file of transformFiles) {
    try {
      const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      const plugin = mod["transform"] as TransformPlugin | undefined;
      if (typeof plugin?.id !== "string" || typeof plugin.apply !== "function") {
        throw new Error(
          "Plugin file must export: export const transform: TransformPlugin with id and apply()",
        );
      }
      transforms.register(plugin);
      logger.debug({ pluginId: plugin.id, file }, "Registered transform plugin");
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ConfigError(
        `Failed to load transform plugin "${path.basename(file)}": ${String(err)}`,
        err,
      );
    }
  }

  if (!mergeStrategies) return;

  const mergeFiles = await findFiles(pluginDir, [".merge.ts", ".merge.js"]);
  for (const file of mergeFiles) {
    try {
      const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      const plugin = mod["mergeStrategy"] as MergeStrategyPlugin | undefined;
      if (typeof plugin?.id !== "string" || typeof plugin.merge !== "function") {
        throw new Error(
          "Plugin file must export: export const mergeStrategy: MergeStrategyPlugin with id and merge()",
        );
      }
      mergeStrategies.register(plugin);
      logger.debug({ pluginId: plugin.id, file }, "Registered merge strategy plugin");
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ConfigError(
        `Failed to load merge strategy plugin "${path.basename(file)}": ${String(err)}`,
        err,
      );
    }
  }
}

// ── Tier 3: npm package plugins ───────────────────────────────────────────────

/** `./x`, `../x`, `.\x`, an absolute path (POSIX or Windows) or a `file:` URL. */
function isPathSpecifier(spec: string): boolean {
  return /^\.\.?([\\/]|$)/.test(spec) || path.isAbsolute(spec) || spec.startsWith("file:");
}

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String(err.code) : undefined;
}

/**
 * Entry URL for a plugin given as a directory (e.g. `./vendor/my-pack`).
 *
 * With an `exports` map the package is resolved by self-reference through the
 * ESM resolver, so `import`-only conditions work. Without one, CommonJS-style
 * directory resolution applies (`main`, extension probing, then `index.js`) —
 * which is what a directory with only `main` means in every other tool.
 */
async function resolvePackageDir(dir: string): Promise<string> {
  const manifestPath = path.join(dir, "package.json");
  let manifest: { name?: unknown; exports?: unknown } | undefined;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as typeof manifest;
  } catch {
    manifest = undefined;
  }
  if (manifest?.exports !== undefined && typeof manifest.name === "string") {
    return esmResolve(manifest.name, pathToFileURL(manifestPath).href);
  }
  const require = createRequire(pathToFileURL(manifestPath).href);
  return pathToFileURL(require.resolve(dir)).href;
}

/**
 * Resolve a `plugins[].package` value to an importable URL.
 *
 * A dynamic `import(spec)` resolves bare specifiers against the IMPORTING file
 * — `dist/plugins/loader.js`, wherever sluice is installed — so a package
 * `npm install`ed in the client project, as PLUGINS.md documents, was never
 * found (DAG-361). Resolution is therefore anchored on `configDir`:
 *
 * - Bare specifiers go through Node's ESM algorithm (`import-meta-resolve`,
 *   conditions `node` + `import`) with `<configDir>/package.json` as parent, so
 *   `exports` maps — including ESM-only ones with just an `import` condition —
 *   behave exactly as `import` would from the project. `createRequire` was
 *   rejected: it resolves with the `require` condition and fails on those.
 *   If the project cannot see the package, sluice's own location is tried
 *   last, so a plugin installed globally alongside sluice keeps working.
 * - Path specifiers resolve against `configDir`, never the process cwd or
 *   sluice's install directory. A directory is treated as a package root.
 *
 * Every filesystem path goes through `pathToFileURL`, which is what makes
 * `C:\…` paths importable on Windows.
 */
async function resolvePluginEntry(spec: string, configDir: string): Promise<string> {
  if (isPathSpecifier(spec)) {
    const abs = spec.startsWith("file:") ? fileURLToPath(spec) : path.resolve(configDir, spec);
    const stat = await fs.stat(abs).catch(() => undefined);
    if (stat?.isDirectory()) return resolvePackageDir(abs);
    if (!stat) {
      throw new Error(
        `"${abs}" does not exist (relative plugin paths resolve against ${configDir})`,
      );
    }
    return pathToFileURL(abs).href;
  }

  const projectParent = pathToFileURL(path.join(configDir, "package.json")).href;
  try {
    return esmResolve(spec, projectParent);
  } catch (projectErr) {
    if (errorCode(projectErr) !== "ERR_MODULE_NOT_FOUND") throw projectErr;
    try {
      return esmResolve(spec, import.meta.url);
    } catch {
      throw new Error(
        `Cannot find package "${spec}" from ${configDir} (the directory holding ` +
          `sluice.config.yaml) or from sluice's own install location. Run ` +
          `"npm install ${spec}" in ${configDir}. Cause: ${String(projectErr)}`,
      );
    }
  }
}

/**
 * Read `sluice.config.yaml` at `configPath`, parse it with
 * `ToolkitConfigSchema`, then import each declared npm package and call its
 * `plugin.register()` function. Packages resolve from the directory holding
 * `configPath` — see `resolvePluginEntry`.
 *
 * Silently returns if `configPath` does not exist.
 * Throws `ConfigError` for unreadable config files, packages that fail to
 * import, or packages that do not export `plugin.register`.
 */
export async function loadNpmPlugins(
  configPath: string,
  rules: RuleRegistry,
  transforms: TransformRegistry,
  mergeStrategies?: typeof MergeStrategyRegistry,
): Promise<void> {
  try {
    await fs.access(configPath);
  } catch {
    return;
  }

  let raw: unknown;
  try {
    raw = yamlLoad(await fs.readFile(configPath, "utf-8"));
  } catch (err) {
    throw new ConfigError(`Failed to read toolkit config "${configPath}": ${String(err)}`, err);
  }

  const config = ToolkitConfigSchema.parse(raw);
  const configDir = path.dirname(path.resolve(configPath));

  for (const entry of config.plugins) {
    try {
      const url = await resolvePluginEntry(entry.package, configDir);
      const pkg = (await import(url)) as Record<string, unknown>;
      const exported = (pkg["plugin"] ?? pkg["default"]) as
        | {
            register: (
              r: RuleRegistry,
              t: TransformRegistry,
              o?: Record<string, unknown>,
              m?: typeof MergeStrategyRegistry,
            ) => void;
          }
        | undefined;
      if (typeof exported?.register !== "function") {
        throw new Error(`Package "${entry.package}" must export plugin.register()`);
      }
      exported.register(rules, transforms, entry.options, mergeStrategies);
      logger.info({ package: entry.package }, "Loaded npm plugin package");
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ConfigError(
        `Failed to load plugin package "${entry.package}": ${String(err)}`,
        err,
      );
    }
  }
}
