/**
 * Example DQ rule plugin — validates that a value is a valid email address
 * with additional strictness (no disposable domains).
 *
 * ID: strict-email
 * Usage in DQ config:
 *   - field: email
 *     checks:
 *       - type: strict-email
 *         severity: warning
 */

import type { RulePlugin } from '../../../src/plugins/types.js';
import type { CheckConfig } from '../../../src/config/types.js';
import type { RuleViolation } from '../../../src/dq/rules/types.js';

const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'throwaway.email',
]);

export const rule: RulePlugin = {
  id: 'strict-email',
  validate(value: unknown, config: CheckConfig, rowIndex: number, field: string): RuleViolation | null {
    if (value === null || value === undefined || value === '') return null;

    const email = String(value).toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return {
        field,
        rowIndex,
        value,
        rule: 'strict-email',
        severity: config.severity,
        message: config.message ?? `"${email}" is not a valid email address`,
      };
    }

    const domain = email.split('@')[1];
    if (domain && DISPOSABLE_DOMAINS.has(domain)) {
      return {
        field,
        rowIndex,
        value,
        rule: 'strict-email',
        severity: config.severity,
        message: config.message ?? `"${email}" uses a disposable email domain`,
      };
    }

    return null;
  },
};
