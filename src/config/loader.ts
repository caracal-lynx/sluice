import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { load as yamlLoad } from 'js-yaml';
import { PipelineSchema, CompositeRuleLibrarySchema, CheckType } from './schema.js';
import type { Pipeline } from './schema.js';
import { ConfigError } from '../utils/errors.js';
import { requireEnv } from '../utils/env.js';

export class ConfigLoader {
  static async load(yamlPath: string): Promise<Pipeline> {
    // 1. Read file
    let raw: string;
    try {
      raw = await readFile(yamlPath, 'utf-8');
    } catch (err) {
      if (isEnoent(err)) {
        throw new ConfigError(`Pipeline file not found: ${yamlPath}`, err);
      }
      throw err;
    }

    // 2. Interpolate ${ENV_VAR} tokens
    const interpolated = raw.replace(/\$\{([^}]+)\}/g, (_match, name: string) =>
      requireEnv(name),
    );

    // 3. Parse YAML
    let parsed: unknown;
    try {
      parsed = yamlLoad(interpolated);
    } catch (err) {
      throw new ConfigError(`Invalid YAML in pipeline file: ${yamlPath}`, err);
    }

    // 4. Expand composite DQ rules (rulesFile → built-in checks)
    parsed = await expandCompositeRules(parsed, yamlPath);

    // 5. Validate with Zod schema (let ZodError propagate to the caller)
    return PipelineSchema.parse(parsed);
  }
}

/**
 * If the raw parsed pipeline object references `dq.rulesFile`, load the
 * composite rule library, build a map of id → checks, then walk
 * `dq.rules[].checks[]` replacing any composite check entries with their
 * constituent built-in checks (applying a severity override if present).
 *
 * Mutates and returns `raw` so downstream code sees built-in check types only.
 */
async function expandCompositeRules(raw: unknown, pipelineYamlPath: string): Promise<unknown> {
  const obj = raw as Record<string, unknown>;
  const dq  = obj['dq'] as Record<string, unknown> | undefined;

  if (!dq || !dq['rulesFile']) {
    return raw;
  }

  const rulesFileRel = dq['rulesFile'] as string;
  const rulesFilePath = path.resolve(path.dirname(pipelineYamlPath), rulesFileRel);

  // Load the composite rule library
  let rulesFileContent: string;
  try {
    rulesFileContent = await readFile(rulesFilePath, 'utf-8');
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

  // Build composite map: id → checks[]
  const compositeMap = new Map(library.rules.map(r => [r.id, r.checks]));

  // Built-in check type names
  const builtInTypes = new Set<string>(CheckType.options);

  // Expand checks in each dq rule
  const rules = dq['rules'];
  if (!Array.isArray(rules)) {
    return raw;
  }

  dq['rules'] = rules.map((rule: unknown) => {
    const r = rule as Record<string, unknown>;
    const checks = r['checks'];
    if (!Array.isArray(checks)) return r;

    const expanded: unknown[] = [];
    for (const check of checks) {
      const c = check as Record<string, unknown>;
      const checkType = c['type'] as string;

      if (builtInTypes.has(checkType)) {
        // Built-in check — keep as-is
        expanded.push(c);
      } else if (compositeMap.has(checkType)) {
        // Composite rule — expand, applying severity override if present
        const compositeChecks = compositeMap.get(checkType)!;
        const severityOverride = c['severity'] as string | undefined;
        for (const cc of compositeChecks) {
          expanded.push(
            severityOverride !== undefined
              ? { ...cc, severity: severityOverride }
              : { ...cc },
          );
        }
      } else {
        throw new ConfigError(
          `Unknown rule type "${checkType}" in field rule — not a built-in check and not found in rulesFile. ` +
          `Available composite rules: [${[...compositeMap.keys()].join(', ')}]`,
        );
      }
    }

    return { ...r, checks: expanded };
  });

  return raw;
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === 'ENOENT';
}
