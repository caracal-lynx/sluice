/**
 * Fixture rule plugin for loader tests.
 * Validates that a string value is fully uppercase.
 */

import type { RulePlugin, RuleViolation } from "../../../src/plugins/types.js";
import type { CheckConfig } from "../../../src/config/types.js";

export const rule: RulePlugin = {
  id: "testIsUppercase",
  description: "Fixture: value must be entirely uppercase",
  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    if (value === null || value === undefined || value === "") return null;
    const str = String(value);
    if (str === str.toUpperCase()) return null;
    return {
      field,
      rowIndex,
      value,
      rule: "testIsUppercase",
      severity: config.severity,
      message: config.message ?? `${field} must be uppercase`,
    };
  },
};
