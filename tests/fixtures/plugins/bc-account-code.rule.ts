/**
 * Business Central account code validator.
 * Validates G/L account codes: typically 4-10 chars, alphanumeric + hyphens.
 *
 * ID: bc-account-code
 * Severity: typically critical (bad account codes break imports)
 */

import type { RulePlugin } from '../../../src/plugins/types.js';

export const rule: RulePlugin = {
  id: 'bc-account-code',
  validate(value, config, rowIndex, field) {
    if (value === null || value === undefined || value === '') return null;

    const code = String(value).trim();

    // Business Central account codes: 4-10 chars, alphanumeric + hyphens, can't start/end with hyphen
    if (code.length < 4 || code.length > 10) {
      return {
        field,
        rowIndex,
        value,
        rule: 'bc-account-code',
        severity: config.severity,
        message: config.message ?? `Account code must be 4-10 characters (got "${code}")`,
      };
    }

    if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/i.test(code)) {
      return {
        field,
        rowIndex,
        value,
        rule: 'bc-account-code',
        severity: config.severity,
        message:
          config.message ??
          `Account code must be alphanumeric with optional hyphens (got "${code}")`,
      };
    }

    return null;
  },
};
