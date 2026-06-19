// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import type { CheckConfig } from "../../config/types.js";
import { stringifyValue } from "../../utils/stringify.js";
import type { Rule, RuleViolation } from "./types.js";

// Covers all current UK postcode formats after whitespace stripping:
//   A9 9AA, A99 9AA, AA9 9AA, AA99 9AA, A9A 9AA, AA9A 9AA
const UK_POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;

export class UkPostcodeRule implements Rule {
  readonly id = "ukPostcode";

  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null {
    if (value === null || value === undefined || value === "") return null;
    const normalised = stringifyValue(value).replace(/\s+/g, "").toUpperCase();
    if (UK_POSTCODE_RE.test(normalised)) return null;
    return {
      field,
      rowIndex,
      value,
      rule: "ukPostcode",
      severity: config.severity,
      message: config.message ?? `${field} is not a valid UK postcode`,
    };
  }
}
