/**
 * Company name normalizer — cleans and standardizes company names.
 * Removes common suffixes (Ltd, Inc, LLC), removes extra spaces, title cases.
 *
 * ID: normalize-company-name
 * Options:
 *   - removeSuffixes: boolean (default: true) - remove Ltd, Inc, LLC, etc.
 *   - titleCase: boolean (default: true) - convert to Title Case
 *   - maxLength: number (default: 100) - truncate after N chars
 */

import type { TransformPlugin } from "../../../src/plugins/types.js";

const COMPANY_SUFFIXES = [
  "ltd.",
  "ltd",
  "inc.",
  "inc",
  "llc",
  "llc.",
  "corp.",
  "corp",
  "co.",
  "co",
  "gmbh",
  "ag",
  "sa",
  "bv",
  "plc",
  "plc.",
];

export const transform: TransformPlugin = {
  id: "normalize-company-name",
  apply: async (value, options) => {
    if (value === null || value === undefined) return null;

    let name = String(value).trim();
    if (name === "") return null;

    const removeSuffixes = (options?.removeSuffixes as boolean) ?? true;
    const titleCase = (options?.titleCase as boolean) ?? true;
    const maxLength = (options?.maxLength as number) ?? 100;

    // Step 1: Normalize whitespace
    name = name.replace(/\s+/g, " ");

    // Step 2: Remove common suffixes
    if (removeSuffixes) {
      const nameLower = name.toLowerCase();
      for (const suffix of COMPANY_SUFFIXES) {
        if (nameLower.endsWith(suffix)) {
          name = name.substring(0, name.length - suffix.length).trim();
          break;
        }
      }
    }

    // Step 3: Convert to title case
    if (titleCase) {
      name = name
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
    }

    // Step 4: Truncate if needed
    if (maxLength > 0 && name.length > maxLength) {
      name = name.substring(0, maxLength).trim();
    }

    return name === "" ? null : name;
  },
};
