/**
 * Template: Sluice Rule Plugin
 *
 * Copy this file to your plugins/ directory and fill in:
 * 1. Change the filename to match your rule name: my-rule.rule.ts
 * 2. Update the id field below
 * 3. Implement your validation logic in the validate() function
 *
 * Example usage in pipeline.yaml:
 *   dq:
 *     rules:
 *       - field: MyField
 *         checks:
 *           - type: my-rule
 *             severity: warning
 */

import type { RulePlugin, RuleViolation } from "../../../src/plugins/types.js";
import type { CheckConfig } from "../../../src/config/types.js";

export const rule: RulePlugin = {
  // ⚠️  REQUIRED: Unique identifier for your rule
  // Used in DQ config as: type: my-rule
  id: "my-rule",

  /**
   * Validate a value against your custom rule.
   *
   * @param value - The field value to validate (may be null/undefined/empty string)
   * @param config - Configuration from the DQ check (includes severity, message)
   * @param rowIndex - 0-based row index (for context in error reporting)
   * @param field - Field name (for context in error reporting)
   * @returns null if valid, or a RuleViolation if invalid
   */
  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    // Step 1: Skip null/undefined/empty values (unless validation is required)
    if (value === null || value === undefined || value === "") {
      return null; // Remove this line if your rule must always validate
    }

    // Step 2: Implement your validation logic
    const stringValue = String(value).trim();

    // Example: check if value is at least 3 characters
    if (stringValue.length < 3) {
      return {
        field,
        rowIndex,
        value,
        rule: this.id,
        severity: config.severity, // 'critical' | 'warning' | 'info'
        message: config.message ?? `${field} must be at least 3 characters (got "${stringValue}")`,
      };
    }

    // Step 3: Return null if validation passes
    return null;
  },
};
