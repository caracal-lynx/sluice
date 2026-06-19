// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Cleanse operations — pure string functions applied left-to-right through
 * the pipe-separated `cleanse:` value on a field mapping.
 *
 * Each op is referenced by name in CLAUDE.md's cleanse operations table. Do
 * NOT add new ops without updating that table AND the BUILTIN_CLEANSE_OPS
 * metadata array below.
 */

import { TransformError } from "../utils/errors.js";
import { stringifyValue } from "../utils/stringify.js";

type CleanseOp = (value: string) => string | null;

/**
 * Metadata for each built-in cleanse op. Exported so external tooling — the
 * MCP server's `list_transform_ops` tool, doc generators, IDE autocomplete
 * helpers — can enumerate the supported ops without grepping this file.
 *
 * Keep this array in sync with `OPS` below and the special-cased ops
 * (`padStart`, `padEnd`, `truncate`) in `applyCleanse`.
 */
export interface BuiltinCleanseOpInfo {
  id: string;
  description: string;
  /** Parameter syntax shown after the op name, when applicable (e.g. `padStart:<width>[:<fill>]`). */
  argSpec?: string;
}

export const BUILTIN_CLEANSE_OPS: readonly BuiltinCleanseOpInfo[] = Object.freeze([
  { id: "trim", description: "Strip leading/trailing whitespace." },
  { id: "uppercase", description: "Uppercase the value." },
  { id: "lowercase", description: "Lowercase the value." },
  { id: "titleCase", description: "Capitalise the first letter of each word." },
  { id: "stripNonAlpha", description: "Remove every character that is not [a-zA-Z]." },
  { id: "stripNonNumeric", description: "Remove every character that is not [0-9]." },
  { id: "stripWhitespace", description: "Remove every whitespace character." },
  { id: "nullIfEmpty", description: "Convert empty strings to null." },
  { id: "normaliseQuotes", description: "Replace smart quotes with their ASCII equivalents." },
  {
    id: "normaliseUnicode",
    description: "NFD-normalise then strip combining marks. Useful for diacritic removal.",
  },
  {
    id: "padStart",
    description: "Left-pad to width with a fill character.",
    argSpec: "padStart:<width>[:<fill>]  (fill defaults to space)",
  },
  {
    id: "padEnd",
    description: "Right-pad to width with a fill character.",
    argSpec: "padEnd:<width>[:<fill>]  (fill defaults to space)",
  },
  {
    id: "truncate",
    description: "Slice to a maximum length.",
    argSpec: "truncate:<length>",
  },
]);

const OPS: Record<string, CleanseOp> = {
  trim: (v) => v.trim(),
  uppercase: (v) => v.toUpperCase(),
  lowercase: (v) => v.toLowerCase(),
  titleCase: (v) =>
    v.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
  stripNonAlpha: (v) => v.replace(/[^a-zA-Z]/g, ""),
  stripNonNumeric: (v) => v.replace(/[^0-9]/g, ""),
  stripWhitespace: (v) => v.replace(/\s+/g, ""),
  nullIfEmpty: (v) => (v === "" ? null : v),
  normaliseQuotes: (v) => v.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"'),
  // NFD → strip combining marks → leave ASCII text
  normaliseUnicode: (v) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
};

export function applyCleanse(value: unknown, spec: string): unknown {
  if (value === null || value === undefined) return value;
  let current: string | null = stringifyValue(value);

  for (const step of spec.split("|")) {
    if (current === null) return null;
    const [name, ...args] = step.split(":");
    if (!name) continue;

    if (name === "padStart") {
      const width = Number.parseInt(args[0] ?? "0", 10);
      const pad = args[1] ?? " ";
      if (!Number.isFinite(width) || width < 0) {
        throw new TransformError(`padStart requires a non-negative width, got "${args[0]}"`);
      }
      current = current.padStart(width, pad);
      continue;
    }
    if (name === "padEnd") {
      const width = Number.parseInt(args[0] ?? "0", 10);
      const pad = args[1] ?? " ";
      if (!Number.isFinite(width) || width < 0) {
        throw new TransformError(`padEnd requires a non-negative width, got "${args[0]}"`);
      }
      current = current.padEnd(width, pad);
      continue;
    }
    if (name === "truncate") {
      const len = Number.parseInt(args[0] ?? "0", 10);
      if (!Number.isFinite(len) || len < 0) {
        throw new TransformError(`truncate requires a non-negative length, got "${args[0]}"`);
      }
      current = current.slice(0, len);
      continue;
    }

    const op = OPS[name];
    if (op === undefined) {
      throw new TransformError(`Unknown cleanse operation: "${name}"`);
    }
    current = op(current);
  }
  return current;
}
