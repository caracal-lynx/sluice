// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import type { CheckConfig } from '../../config/types.js';
import { DQError } from '../../utils/errors.js';
import type { Rule, RuleViolation } from './types.js';

export class AllowedValuesRule implements Rule {
  readonly id = 'allowedValues';

  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    if (value === null || value === undefined || value === '') return null;
    if (!Array.isArray(config.value)) {
      throw new DQError(
        `allowedValues rule on field "${field}" requires an array of permitted strings`,
      );
    }
    const s = String(value);
    if (config.value.includes(s)) return null;
    return {
      field,
      rowIndex,
      value,
      rule: 'allowedValues',
      severity: config.severity,
      message:
        config.message ??
        `${field} value "${s}" not in allowed list [${config.value.join(', ')}]`,
    };
  }
}
