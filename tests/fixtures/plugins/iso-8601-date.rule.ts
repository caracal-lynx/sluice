/**
 * ISO 8601 date validator — validates ISO 8601 format dates.
 * Rejects dates that are not in ISO format (YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss, etc.)
 *
 * ID: iso-8601-date
 * Severity: typically warning (bad format but recoverable)
 */

import type { RulePlugin } from '../../../src/plugins/types.js';

export const rule: RulePlugin = {
  id: 'iso-8601-date',
  validate(value, config, rowIndex, field) {
    if (value === null || value === undefined || value === '') return null;

    const str = String(value).trim();
    const iso8601Regex =
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.{\d{3})?)?([+-]\d{2}:?\d{2}|Z)?$/;

    if (!iso8601Regex.test(str)) {
      return {
        field,
        rowIndex,
        value,
        rule: 'iso-8601-date',
        severity: config.severity,
        message:
          config.message ??
          `"${str}" is not in ISO 8601 format (expected YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)`,
      };
    }

    // Additional check: verify it's a valid date
    const date = new Date(str);
    if (isNaN(date.getTime())) {
      return {
        field,
        rowIndex,
        value,
        rule: 'iso-8601-date',
        severity: config.severity,
        message: config.message ?? `"${str}" is not a valid ISO 8601 date`,
      };
    }

    return null;
  },
};
