// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Unique is handled specially by DQEngine: the engine runs a GROUP BY
 * pre-pass and collects duplicate values per-field, then emits violations
 * directly for rows whose value appears in that set. The validate() method
 * below exists only so the rule fits the registry shape — it always returns
 * null because per-cell validation can't determine uniqueness in isolation.
 */

import type { CheckConfig } from "../../config/types.js";
import type { Rule, RuleViolation } from "./types.js";

export class UniqueRule implements Rule {
  readonly id = "unique";

  validate(
    _value: unknown,
    _config: CheckConfig,
    _rowIndex: number,
    _field: string,
  ): RuleViolation | null {
    return null;
  }
}
