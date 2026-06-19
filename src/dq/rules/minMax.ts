// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import type { CheckConfig } from "../../config/types.js";
import { DQError } from "../../utils/errors.js";
import { stringifyValue } from "../../utils/stringify.js";
import type { Rule, RuleViolation } from "./types.js";

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(stringifyValue(value));
  return Number.isFinite(n) ? n : null;
}

export class MinRule implements Rule {
  readonly id = "min";

  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    if (typeof config.value !== "number") {
      throw new DQError(`min rule on field "${field}" requires a numeric value`);
    }
    const n = toNumber(value);
    if (n === null) return null; // let notNull handle unparseable nulls
    if (n >= config.value) return null;
    return {
      field,
      rowIndex,
      value,
      rule: "min",
      severity: config.severity,
      message: config.message ?? `${field} value ${n} is below minimum ${config.value}`,
    };
  }
}

export class MaxRule implements Rule {
  readonly id = "max";

  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    if (typeof config.value !== "number") {
      throw new DQError(`max rule on field "${field}" requires a numeric value`);
    }
    const n = toNumber(value);
    if (n === null) return null;
    if (n <= config.value) return null;
    return {
      field,
      rowIndex,
      value,
      rule: "max",
      severity: config.severity,
      message: config.message ?? `${field} value ${n} exceeds maximum ${config.value}`,
    };
  }
}
