// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import path from "node:path";
import { readFile } from "node:fs/promises";
import { load as yamlLoad } from "js-yaml";
import { PipelineSchema, CompositeRuleLibrarySchema, CheckType } from "./schema.js";
import { isMultiSource, isSingleSource } from "./schema.js";
import type { Pipeline } from "./schema.js";
// Barrel imports, not registry-module imports: importing the barrel self-registers
// the built-in adapters, which is what makes `.list()` below non-empty. [M-06]
import { SourceAdapterRegistry } from "../adapters/source/index.js";
import { TargetAdapterRegistry } from "../adapters/target/index.js";
import { ConfigError } from "../utils/errors.js";
import { requireEnv } from "../utils/env.js";

/**
 * Ids contributed by plugins, which the config schema cannot know about.
 *
 * DAG-344: `CheckSchema.type` and the adapter fields used to be closed `z.enum`s,
 * so a Tier-2/Tier-3 plugin could register a rule or adapter that no pipeline
 * YAML was then allowed to name. The enums are now open strings and membership
 * is checked here instead — against built-ins UNION whatever is registered — so
 * an unknown id still fails at config-load time rather than mid-run.
 *
 * Callers that have loaded plugins pass `rules`. Adapters are not passed: their
 * registries are process-wide singletons, so this module reads them directly.
 */
export interface KnownPluginIds {
  rules?: Iterable<string>;
}

export class ConfigLoader {
  static async load(yamlPath: string, known: KnownPluginIds = {}): Promise<Pipeline> {
    // 1. Read file
    let raw: string;
    try {
      raw = await readFile(yamlPath, "utf-8");
    } catch (err) {
      if (isEnoent(err)) {
        throw new ConfigError(`Pipeline file not found: ${yamlPath}`, err);
      }
      throw err;
    }

    // 2. Interpolate ${ENV_VAR} tokens.
    // Operates on the raw YAML text, so tokens anywhere — including inside
    // comments or unrelated string values — are resolved. Missing vars throw
    // ConfigError before the YAML is parsed. This is intentional: it keeps
    // the resolver trivial and predictable for single-pass pipelines.
    const interpolated = raw.replace(/\$\{([^}]+)\}/g, (_match, name: string) => requireEnv(name));

    // 3. Parse YAML
    let parsed: unknown;
    try {
      parsed = yamlLoad(interpolated);
    } catch (err) {
      throw new ConfigError(`Invalid YAML in pipeline file: ${yamlPath}`, err);
    }

    // 4. Expand composite DQ rules (rulesFile → built-in checks) and reject any
    //    check id that is neither built-in, composite, nor plugin-registered.
    parsed = await expandCompositeRules(parsed, yamlPath, new Set(known.rules ?? []));

    // 5. Validate with Zod schema (let ZodError propagate to the caller)
    const pipeline = PipelineSchema.parse(parsed);

    // 6. Adapter ids are open strings in the schema, so membership is checked
    //    against the registries here — after parse, where the shape is typed.
    assertAdaptersRegistered(pipeline);

    return pipeline;
  }
}

/**
 * Expand composite DQ rules, then reject any check id that does not exist.
 *
 * Runs on EVERY load, not only when `dq.rulesFile` is set. Before DAG-344 the
 * whole walk was skipped without a rules file, and the closed `CheckType` enum
 * was the only gate — which is exactly why a plugin-contributed rule id could
 * never be named in a pipeline. Now `CheckSchema.type` is an open string and
 * this walk is the gate, admitting built-ins UNION composites UNION registered
 * plugin ids. A typo in a built-in name still fails here, at config-load time.
 *
 * Composite expansion happens first, so a composite may now wrap a plugin rule.
 * The membership check runs over the POST-expansion checks, so a composite that
 * references a rule nobody registered fails too.
 *
 * Mutates and returns `raw`.
 */
async function expandCompositeRules(
  raw: unknown,
  pipelineYamlPath: string,
  knownRuleIds: ReadonlySet<string>,
): Promise<unknown> {
  const obj = raw as Record<string, unknown>;
  const dq = obj["dq"] as Record<string, unknown> | undefined;
  if (!dq) return raw;

  const rulesFileRel = dq["rulesFile"];
  const compositeMap = new Map<string, readonly unknown[]>();

  if (typeof rulesFileRel === "string" && rulesFileRel !== "") {
    const rulesFilePath = path.resolve(path.dirname(pipelineYamlPath), rulesFileRel);

    let rulesFileContent: string;
    try {
      rulesFileContent = await readFile(rulesFilePath, "utf-8");
    } catch (err) {
      if (isEnoent(err)) {
        throw new ConfigError(`rulesFile not found: ${rulesFilePath}`, err);
      }
      throw err;
    }

    let rawLibrary: unknown;
    try {
      rawLibrary = yamlLoad(rulesFileContent);
    } catch (err) {
      throw new ConfigError(`Invalid YAML in rulesFile: ${rulesFilePath}`, err);
    }

    // Validate library schema (let ZodError propagate)
    const library = CompositeRuleLibrarySchema.parse(rawLibrary);

    // Reject duplicate ids explicitly — silently picking the last one would
    // surprise anyone authoring a rules library.
    for (const r of library.rules) {
      if (compositeMap.has(r.id)) {
        throw new ConfigError(
          `Duplicate composite rule id "${r.id}" in ${rulesFilePath}. ` +
            `Each id in the rules library must be unique.`,
        );
      }
      compositeMap.set(r.id, r.checks);
    }

    // rulesFile has served its purpose — drop it so the post-expansion shape
    // matches the engine's expectation that only resolvable check types exist.
    delete dq["rulesFile"];
  }

  const rules = dq["rules"];
  if (!Array.isArray(rules)) {
    return raw;
  }

  dq["rules"] = rules.map((rule: unknown) => {
    const r = rule as Record<string, unknown>;
    const checks = r["checks"];
    if (!Array.isArray(checks)) return r;

    const expanded: unknown[] = [];
    for (const check of checks) {
      const c = check as Record<string, unknown>;
      const checkType = c["type"] as string;
      const composite = compositeMap.get(checkType);

      if (composite === undefined) {
        expanded.push(c);
        continue;
      }

      // Composite rule — expand one level, applying a severity override if present
      const severityOverride = c["severity"] as string | undefined;
      for (const cc of composite) {
        expanded.push(
          severityOverride !== undefined
            ? { ...(cc as object), severity: severityOverride }
            : { ...(cc as object) },
        );
      }
    }

    const unknown = unknownCheckTypes(expanded, knownRuleIds);
    if (unknown.length > 0) {
      throw new ConfigError(
        `Unknown DQ check type "${unknown[0] ?? ""}" on field "${String(r["field"])}". ` +
          `Built-in: [${CheckType.options.join(", ")}]. ` +
          `Composite rules from rulesFile: [${listOrNone([...compositeMap.keys()])}]. ` +
          `Registered plugin rules: [${listOrNone([...knownRuleIds])}]. ` +
          `If this id comes from a plugin package, check it is declared in sluice.config.yaml ` +
          `or present in a plugins/ directory.`,
      );
    }

    return { ...r, checks: expanded };
  });

  return raw;
}

/**
 * Check ids in `checks` that are neither built-in nor registered, in order.
 *
 * Exported because `sluice-mcp` validates AI-authored pipeline objects before
 * writing them and cannot use `ConfigLoader.load` for it: that interpolates
 * `${ENV_VAR}` and would reject a perfectly good pipeline whose variables simply
 * are not set in the MCP server's environment.
 *
 * Composite ids are NOT known here — call this after expansion, or pass the
 * composite ids in `knownIds`.
 */
export function unknownCheckTypes(
  checks: readonly unknown[],
  knownIds: ReadonlySet<string>,
): string[] {
  const builtIn = new Set<string>(CheckType.options);
  const unknown: string[] = [];
  for (const check of checks) {
    const type = (check as Record<string, unknown>)["type"];
    if (typeof type !== "string") continue;
    if (builtIn.has(type) || knownIds.has(type)) continue;
    unknown.push(type);
  }
  return unknown;
}

/**
 * DAG-344: `source.adapter` / `target.adapter` are open strings in the schema so
 * that a plugin-registered adapter can be named at all. Membership is checked
 * here instead — at config-load time, not inside `runLoad()` where a bad target
 * id used to surface only after a full extract and transform had been paid for
 * (DAG-336).
 *
 * The adapter registries are process-wide singletons, so unlike rule ids these
 * need no threading from the caller — but the caller MUST have imported any
 * plugin that registers an adapter before calling `ConfigLoader.load`.
 */
export function assertAdaptersRegistered(pipeline: Pipeline): void {
  const sources: readonly { adapter: string }[] = isMultiSource(pipeline)
    ? pipeline.sources
    : isSingleSource(pipeline)
      ? [pipeline.source]
      : [];
  for (const [i, source] of sources.entries()) {
    if (SourceAdapterRegistry.has(source.adapter)) continue;
    throw new ConfigError(
      `No source adapter registered for "${source.adapter}"` +
        (sources.length > 1 ? ` (sources[${String(i)}])` : "") +
        `. Registered: ${listOrNone(SourceAdapterRegistry.list())}.`,
    );
  }

  if (!TargetAdapterRegistry.has(pipeline.target.adapter)) {
    throw new ConfigError(
      `No target adapter registered for "${pipeline.target.adapter}". ` +
        `Registered: ${listOrNone(TargetAdapterRegistry.list())}.`,
    );
  }
}

function listOrNone(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(", ") : "(none)";
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === "ENOENT";
}
