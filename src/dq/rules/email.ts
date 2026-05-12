// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import type { CheckConfig } from '../../config/types.js';
import type { Rule, RuleViolation } from './types.js';

// Pragmatic RFC 5322-ish regex — matches the vast majority of real addresses
// without the full 400-line spec. Rejects leading/trailing dots, multiple @,
// and obviously-malformed domains.
const EMAIL_RE =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export class EmailRule implements Rule {
  readonly id = 'email';

  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    if (value === null || value === undefined || value === '') return null;
    if (EMAIL_RE.test(String(value))) return null;
    return {
      field,
      rowIndex,
      value,
      rule: 'email',
      severity: config.severity,
      message: config.message ?? `${field} is not a valid email address`,
    };
  }
}
