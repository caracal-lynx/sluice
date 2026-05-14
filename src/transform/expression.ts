// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Expression evaluator.
 *
 * Two dispatch paths per CLAUDE.md:
 *   - No `js:` prefix → expr-eval Parser (safe, limited to arithmetic + member access).
 *   - `js:` prefix → vm.runInNewContext with a restricted global set.
 *
 * Neither path uses `eval()` or `new Function()`.
 */

import { runInNewContext } from 'node:vm';

import { Parser, type Value } from 'expr-eval-fork';

import { ExpressionError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const parser = new Parser();

export class ExpressionEvaluator {
  private readonly warnedExpressions = new Set<string>();

  evaluate(expression: string, row: Record<string, unknown>): unknown {
    if (expression.startsWith('js:')) {
      const code = expression.slice(3).trim();
      if (!this.warnedExpressions.has(code)) {
        this.warnedExpressions.add(code);
        logger.warn({ expression: code }, 'expression: using js: path (vm.runInNewContext)');
      }
      try {
        return runInNewContext(
          code,
          {
            row,
            Date,
            Math,
            JSON,
            String,
            Number,
            Boolean,
          },
          { timeout: 1000 },
        );
      } catch (err) {
        throw new ExpressionError(
          `js expression failed: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    }
    try {
      // expr-eval's Value type is narrower than Record<string, unknown>, but
      // at runtime it only traverses property access — non-primitive leaves
      // are fine as long as the expression doesn't operate on them.
      return parser.parse(expression).evaluate({ row } as unknown as Value);
    } catch (err) {
      throw new ExpressionError(
        `expr-eval expression failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
