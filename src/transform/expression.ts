// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Expression evaluator.
 *
 * Two dispatch paths per CLAUDE.md:
 *   - No `js:` prefix → expr-eval Parser (safe, limited to arithmetic + member access).
 *   - `js:` prefix → a fresh `node:vm` context per evaluation.
 *
 * Sluice itself never calls `eval()` or `new Function()`, and the `js:` context refuses
 * both (`codeGeneration.strings: false`). The context is created with `DONT_CONTEXTIFY`
 * and receives no host objects: it uses its own built-ins, and `row` is copied into its
 * realm. A host object inside the context would expose the host's `Function`
 * constructor (`row.constructor.constructor("return process")()`), which is how this
 * escaped before DAG-397. Results are copied back out, so the host gets host-realm
 * Dates, arrays and objects.
 *
 * `node:vm` is still not a security boundary (Node's own docs say so). This closes the
 * known escapes; it does not make `js:` safe for pipeline YAML from an untrusted author.
 */

import { constants, createContext, runInContext } from "node:vm";

import { Parser, type Value } from "expr-eval-fork";

import { ExpressionError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const parser = new Parser();

/** The context realm's own constructors, used to build values inside it. */
interface Realm {
  Object: ObjectConstructor;
  Array: ArrayConstructor;
  Date: DateConstructor;
  Uint8Array: Uint8ArrayConstructor;
}

/**
 * Deep-copies a host value into the context realm. DuckDB's `getRowObjectsJS` yields
 * primitives (bigint included), Dates, arrays, plain objects and byte arrays. Functions
 * are dropped: a host function is a direct route back to the host `Function`.
 */
function intoRealm(value: unknown, realm: Realm): unknown {
  if (typeof value === "function") return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new realm.Date(value.getTime());
  if (value instanceof Uint8Array) return realm.Uint8Array.from(value);
  if (Array.isArray(value)) {
    const out = new realm.Array();
    for (const item of value) out.push(intoRealm(item, realm));
    return out;
  }
  const out = new realm.Object() as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) {
    // defineProperty, not assignment, so a "__proto__" key stays an ordinary key.
    realm.Object.defineProperty(out, key, {
      value: intoRealm(item, realm),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** Copies a context-realm result back into the host realm. Checks are realm-agnostic. */
function fromRealm(value: unknown): unknown {
  if (typeof value === "function") return undefined;
  if (value === null || typeof value !== "object") return value;
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Date]") return new Date((value as Date).getTime());
  if (tag === "[object Uint8Array]") return Uint8Array.from(value as Uint8Array);
  if (Array.isArray(value)) return value.map((item: unknown) => fromRealm(item));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(out, key, {
      value: fromRealm(item),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

function runJs(code: string, row: Record<string, unknown>): unknown {
  // A fresh context per call: one expression can't change built-ins for the next.
  const context = createContext(constants.DONT_CONTEXTIFY, {
    codeGeneration: { strings: false, wasm: false },
  }) as Record<string, unknown>;
  const realm = runInContext("({ Object, Array, Date, Uint8Array })", context) as Realm;
  context["row"] = intoRealm(row, realm);
  return fromRealm(runInContext(code, context, { timeout: 1000 }));
}

export class ExpressionEvaluator {
  private readonly warnedExpressions = new Set<string>();

  evaluate(expression: string, row: Record<string, unknown>): unknown {
    if (expression.startsWith("js:")) {
      const code = expression.slice(3).trim();
      if (!this.warnedExpressions.has(code)) {
        this.warnedExpressions.add(code);
        logger.warn({ expression: code }, "expression: using js: path (node:vm context)");
      }
      try {
        return runJs(code, row);
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
