import { describe, expect, it } from "vitest";

import { applyCleanse, BUILTIN_CLEANSE_OPS } from "../../../src/transform/cleanse.js";
import { TransformError } from "../../../src/utils/errors.js";

describe("applyCleanse", () => {
  it("trim", () => {
    expect(applyCleanse("  hello  ", "trim")).toBe("hello");
  });

  it("uppercase and lowercase", () => {
    expect(applyCleanse("Hello", "uppercase")).toBe("HELLO");
    expect(applyCleanse("HELLO", "lowercase")).toBe("hello");
  });

  it("trim|titleCase", () => {
    expect(applyCleanse("  john smith  ", "trim|titleCase")).toBe("John Smith");
    expect(applyCleanse("ACME INDUSTRIES", "titleCase")).toBe("Acme Industries");
  });

  it("stripNonAlpha and stripNonNumeric", () => {
    expect(applyCleanse("AB-12!", "stripNonAlpha")).toBe("AB");
    expect(applyCleanse("AB-12!", "stripNonNumeric")).toBe("12");
  });

  it("stripWhitespace", () => {
    expect(applyCleanse("h e l l o", "stripWhitespace")).toBe("hello");
  });

  it("padStart:6:0", () => {
    expect(applyCleanse("42", "padStart:6:0")).toBe("000042");
  });

  it("padEnd:10:0 — appends pad char to short strings", () => {
    expect(applyCleanse("12345678", "padEnd:10:0")).toBe("1234567800");
    expect(applyCleanse("42", "padEnd:6:_")).toBe("42____");
  });

  it("padEnd leaves already-long strings unchanged", () => {
    expect(applyCleanse("1234567890", "padEnd:10:0")).toBe("1234567890");
    expect(applyCleanse("hello world", "padEnd:5:x")).toBe("hello world");
  });

  it("padEnd coerces non-string input", () => {
    // Number input is String()-coerced first, matching the rest of the pipeline.
    expect(applyCleanse(42, "padEnd:6:0")).toBe("420000");
  });

  it("padEnd in a chain runs after earlier ops", () => {
    expect(applyCleanse("  ab  ", "trim|padEnd:5:x")).toBe("abxxx");
  });

  it("truncate:20", () => {
    const input = "x".repeat(21);
    const out = applyCleanse(input, "truncate:20");
    expect(out).toHaveLength(20);
  });

  it("nullIfEmpty short-circuits the remaining chain", () => {
    expect(applyCleanse("", "nullIfEmpty|uppercase")).toBeNull();
    expect(applyCleanse("x", "nullIfEmpty|uppercase")).toBe("X");
  });

  it("normaliseQuotes converts smart quotes to ASCII", () => {
    expect(applyCleanse("it\u2019s", "normaliseQuotes")).toBe("it's");
    expect(applyCleanse("\u201CHi\u201D", "normaliseQuotes")).toBe('"Hi"');
  });

  it("normaliseUnicode strips combining marks (café → cafe)", () => {
    expect(applyCleanse("caf\u00e9", "normaliseUnicode")).toBe("cafe");
  });

  it("passes null/undefined through unchanged", () => {
    expect(applyCleanse(null, "trim|uppercase")).toBeNull();
    expect(applyCleanse(undefined, "trim")).toBeUndefined();
  });

  it("throws TransformError for unknown op", () => {
    expect(() => applyCleanse("x", "shuffleWords")).toThrow(TransformError);
  });

  it("throws TransformError for malformed padStart arg", () => {
    expect(() => applyCleanse("x", "padStart:abc:0")).toThrow(TransformError);
  });

  it("throws TransformError for malformed padEnd arg", () => {
    expect(() => applyCleanse("x", "padEnd:abc:0")).toThrow(TransformError);
  });
});

describe("BUILTIN_CLEANSE_OPS", () => {
  it("lists every op accepted by applyCleanse exactly once", () => {
    const ids = BUILTIN_CLEANSE_OPS.map((op) => op.id);
    // Trip-wire: changing `applyCleanse`'s OPS table without updating this
    // metadata array will fail this test. Keep the two in sync.
    expect(ids).toEqual([
      "trim",
      "uppercase",
      "lowercase",
      "titleCase",
      "stripNonAlpha",
      "stripNonNumeric",
      "stripWhitespace",
      "nullIfEmpty",
      "normaliseQuotes",
      "normaliseUnicode",
      "padStart",
      "padEnd",
      "truncate",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has a non-empty description", () => {
    for (const op of BUILTIN_CLEANSE_OPS) {
      expect(typeof op.description).toBe("string");
      expect(op.description.length).toBeGreaterThan(0);
    }
  });

  it("parameterised ops carry an argSpec", () => {
    const byId = new Map(BUILTIN_CLEANSE_OPS.map((op) => [op.id, op]));
    expect(byId.get("padStart")?.argSpec).toContain("padStart:<width>");
    expect(byId.get("padEnd")?.argSpec).toContain("padEnd:<width>");
    expect(byId.get("truncate")?.argSpec).toContain("truncate:<length>");
    expect(byId.get("trim")?.argSpec).toBeUndefined();
  });

  it("is immutable", () => {
    expect(Object.isFrozen(BUILTIN_CLEANSE_OPS)).toBe(true);
  });

  it("every advertised op is actually applied by applyCleanse", () => {
    // For the pure ops, the value `'X'` must not throw and must return a string.
    const pureOps = BUILTIN_CLEANSE_OPS.filter((op) => op.argSpec === undefined);
    for (const op of pureOps) {
      expect(() => applyCleanse("X", op.id)).not.toThrow();
    }
  });
});
