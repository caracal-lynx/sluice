// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Safely render an unknown value (typically a cell value or untyped input) as a
 * string. Behaves identically to `String()` for primitives, but renders objects
 * explicitly (Date → ISO, others → JSON) instead of the useless `"[object
 * Object]"`. Satisfies `@typescript-eslint/no-base-to-string` at the boundary
 * where data is genuinely `unknown`.
 */
export function stringifyValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    if (value instanceof Date) return value.toISOString();
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserialisable object]";
    }
  }
  // Primitives, null, undefined, bigint, boolean, symbol — all safe for String().
  return String(value);
}
