// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

import type { CheckConfig } from '../../config/types.js';
import { DQError } from '../../utils/errors.js';
import type { Rule, RuleViolation } from './types.js';

export class PatternRule implements Rule {
  readonly id = 'pattern';

  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof config.value !== 'string') {
      throw new DQError(`pattern rule on field "${field}" requires a string value (the regex)`);
    }
    let regex: RegExp;
    try {
      regex = new RegExp(config.value);
    } catch (err) {
      throw new DQError(
        `pattern rule on field "${field}" has invalid regex "${config.value}"`,
        err,
      );
    }
    if (regex.test(String(value))) return null;
    return {
      field,
      rowIndex,
      value,
      rule: 'pattern',
      severity: config.severity,
      message: config.message ?? `${field} does not match pattern ${config.value}`,
    };
  }
}
