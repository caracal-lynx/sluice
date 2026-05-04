// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

import type { CheckConfig } from '../../config/types.js';
import type { Rule, RuleViolation } from './types.js';

export class NotNullRule implements Rule {
  readonly id = 'notNull';

  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    const isNull =
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim() === '');
    if (!isNull) return null;
    return {
      field,
      rowIndex,
      value,
      rule: 'notNull',
      severity: config.severity,
      message: config.message ?? `${field} must not be null or empty`,
    };
  }
}
