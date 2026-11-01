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

  describe("js: path (node:vm context)", () => {
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

    // DAG-397: the documented contract is "never eval(), never new Function()". Each of
    // these used to work, and the constructor routes reached the host's process object.
    it.each([
      ["eval", "js: eval('1 + 1')"],
      ["Function", "js: Function('return 1')()"],
      ["new Function", "js: new Function('return 1')()"],
      ["arrow constructor", "js: (() => 0).constructor('return 1')()"],
      ["global constructor", "js: this.constructor.constructor('return process')()"],
      ["row constructor", "js: row.constructor.constructor('return process')()"],
      ["Math constructor", "js: Math.constructor.constructor('return process')()"],
      ["String constructor", "js: String.constructor('return process')()"],
    ])("blocks code generation via %s", (_label, expression) => {
      expect(() => eval_.evaluate(expression, { a: 1 })).toThrow(ExpressionError);
    });

    it("hands row values to the expression intact", () => {
      const when = new Date("2026-01-02T03:04:05.000Z");
      const row = {
        s: "x",
        n: 1.5,
        big: 12345678901234567890n,
        flag: true,
        none: null,
        when,
        list: [1, "two"],
        obj: { a: { b: 2 } },
        bytes: new Uint8Array([1, 2, 3]),
      };
      expect(
        eval_.evaluate(
          "js: [typeof row.big, row.big + 1n, row.when.toISOString(), row.list[1], row.obj.a.b, row.bytes[2], row.none, row.flag].join('|')",
          row,
        ),
      ).toBe(`bigint|12345678901234567891|2026-01-02T03:04:05.000Z|two|2|3||true`);
    });

    it("returns values the host can use: Dates, arrays and objects from the host realm", () => {
      const date = eval_.evaluate("js: new Date(Date.UTC(2026, 0, 2))", {});
      expect(date).toBeInstanceOf(Date);
      expect((date as Date).toISOString()).toBe("2026-01-02T00:00:00.000Z");

      const list = eval_.evaluate("js: [row.a, { b: row.a }]", { a: 1 });
      expect(Array.isArray(list)).toBe(true);
      expect(list).toEqual([1, { b: 1 }]);
      expect(Object.getPrototypeOf((list as unknown[])[1])).toBe(Object.prototype);
    });

    it("does not let one expression's changes leak into the next", () => {
      eval_.evaluate("js: (Math.round = () => 99, 0)", {});
      expect(eval_.evaluate("js: Math.round(1.4)", {})).toBe(1);
    });
  });
});
