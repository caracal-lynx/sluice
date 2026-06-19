import { describe, expect, it } from "vitest";

import { ExpressionEvaluator } from "../../../src/transform/expression.js";
import { ExpressionError } from "../../../src/utils/errors.js";

describe("ExpressionEvaluator", () => {
  const eval_ = new ExpressionEvaluator();

  describe("expr-eval path (no js: prefix)", () => {
    it("evaluates arithmetic on row fields", () => {
      expect(eval_.evaluate("row.a + row.b", { a: 2, b: 3 })).toBe(5);
    });

    it("supports member access", () => {
      expect(eval_.evaluate("row.x", { x: 42 })).toBe(42);
    });

    it("throws ExpressionError on invalid expression", () => {
      expect(() => eval_.evaluate("row.a +", {})).toThrow(ExpressionError);
    });
  });

  describe("js: path (vm.runInNewContext)", () => {
    it("evaluates arbitrary JS with access to row and built-ins", () => {
      expect(
        eval_.evaluate("js: row.name.toUpperCase().substring(0, 5)", { name: "alice smith" }),
      ).toBe("ALICE");
    });

    it("allows Math and Date usage", () => {
      expect(eval_.evaluate("js: Math.round(row.x)", { x: 3.7 })).toBe(4);
    });

    it("denies access to node builtins like process", () => {
      expect(() => eval_.evaluate("js: process.env.SECRET", {})).toThrow(ExpressionError);
    });

    it("enforces a timeout on runaway loops", () => {
      expect(() => eval_.evaluate("js: while (true) {}", {})).toThrow(ExpressionError);
    });
  });
});
