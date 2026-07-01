// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Shared JSON-shaping helpers used by the `rest` and `json` source adapters.
 *
 * Both adapters land arbitrary JSON records into a VARCHAR staging table, so
 * they share the same three concerns: walk a dot-path into a response/body,
 * flatten nested objects, and collect the union of column names.
 */

import type { ColumnMeta } from "../staging/index.js";

/** Walk a dot-path (`a.b.c`) into a nested object. Returns undefined if any hop is missing. */
export function getPath(obj: unknown, dotPath: string): unknown {
  let cur: unknown = obj;
  for (const key of dotPath.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Flatten nested objects with a `__` separator (`a.b` → `a__b`). Arrays are
 * JSON-stringified into a single cell (staging is VARCHAR-only; array structure
 * is preserved as text for a later transform to unpack if needed).
 */
export function flatten(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}__${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      flatten(v as Record<string, unknown>, key, out);
    } else {
      out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
  }
  return out;
}

/** Union of keys across all rows, each typed VARCHAR (staging is untyped text). */
export function collectColumns(rows: Record<string, unknown>[]): ColumnMeta[] {
  const names = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) names.add(k);
  }
  return [...names].map((n) => ({ name: n, duckDbType: "VARCHAR" }));
}
