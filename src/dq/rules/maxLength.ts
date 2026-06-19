// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import type { CheckConfig } from "../../config/types.js";
import { DQError } from "../../utils/errors.js";
import { stringifyValue } from "../../utils/stringify.js";
import type { Rule, RuleViolation } from "./types.js";

export class MaxLengthRule implements Rule {
  readonly id = "maxLength";

  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    if (value === null || value === undefined) return null;
    if (typeof config.value !== "number") {
      throw new DQError(`maxLength rule on field "${field}" requires a numeric value`);
    }
    const len = stringifyValue(value).length;
    if (len <= config.value) return null;
    return {
      field,
      rowIndex,
      value,
      rule: "maxLength",
      severity: config.severity,
      message: config.message ?? `${field} length ${len} exceeds maximum ${config.value}`,
    };
  }
}
