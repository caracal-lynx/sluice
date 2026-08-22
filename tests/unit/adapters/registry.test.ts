// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Registry behaviour, exercised once against both adapter registries.
 *
 * `SourceAdapterRegistry` and `TargetAdapterRegistry` are the same
 * implementation twice over — identical apart from the adapter type they hold.
 * DAG-182 reported the target side as untested and proposed copying the source
 * side's cases across; that would have duplicated the tests to match the
 * duplicated source, so the cases are written once here and run against both.
 *
 * Each case wires its own concrete registry and a correctly-typed stub adapter,
 * so nothing is cast away and a future divergence between the two interfaces
 * fails to compile rather than passing quietly.
 *
 * Every test registers ids under a `dag182-` prefix and unregisters them again,
 * because the registries are module-global: a leaked id would surface as an
 * unrelated failure in whichever file ran next.
 */

import { afterEach, describe, expect, it } from "vitest";

import { SourceAdapterRegistry } from "../../../src/adapters/source/index.js";
import { TargetAdapterRegistry } from "../../../src/adapters/target/index.js";
import { ConfigError } from "../../../src/utils/errors.js";

interface RegistryCase {
  /** An id the barrel import self-registers, used to prove built-ins are present. */
  readonly builtIn: string;
  readonly has: (id: string) => boolean;
  readonly list: () => string[];
  readonly getId: (id: string) => string;
  readonly register: (id: string) => void;
  readonly unregister: (id: string) => void;
}

const CASES: ReadonlyArray<readonly [string, RegistryCase]> = [
  [
    "SourceAdapterRegistry",
    {
      builtIn: "csv",
      has: (id) => SourceAdapterRegistry.has(id),
      list: () => SourceAdapterRegistry.list(),
      getId: (id) => SourceAdapterRegistry.get(id).id,
      register: (id) =>
        SourceAdapterRegistry.register({
          id,
          connect: async () => {},
          disconnect: async () => {},
          extract: async () => ({ rowsExtracted: 0, tableName: "stg_raw", columns: [] }),
        }),
      unregister: (id) => SourceAdapterRegistry.unregister(id),
    },
  ],
  [
    "TargetAdapterRegistry",
    {
      builtIn: "csv",
      has: (id) => TargetAdapterRegistry.has(id),
      list: () => TargetAdapterRegistry.list(),
      getId: (id) => TargetAdapterRegistry.get(id).id,
      register: (id) =>
        TargetAdapterRegistry.register({
          id,
          connect: async () => {},
          disconnect: async () => {},
          load: async () => ({ rowsLoaded: 0, rowsFailed: 0 }),
        }),
      unregister: (id) => TargetAdapterRegistry.unregister(id),
    },
  ],
];

describe.each(CASES)("%s", (_label, reg) => {
  const registered: string[] = [];

  const registerTracked = (id: string): void => {
    reg.register(id);
    registered.push(id);
  };

  afterEach(() => {
    for (const id of registered.splice(0)) reg.unregister(id);
  });

  it("self-registers built-ins on barrel import", () => {
    expect(reg.has(reg.builtIn)).toBe(true);
    expect(reg.list()).toContain(reg.builtIn);
    expect(reg.getId(reg.builtIn)).toBe(reg.builtIn);
  });

  it("register() makes an adapter retrievable by id", () => {
    registerTracked("dag182-register");

    expect(reg.has("dag182-register")).toBe(true);
    expect(reg.getId("dag182-register")).toBe("dag182-register");
    expect(reg.list()).toContain("dag182-register");
  });

  it("register() throws ConfigError on a duplicate id", () => {
    registerTracked("dag182-duplicate");

    expect(() => reg.register("dag182-duplicate")).toThrow(ConfigError);
  });

  it("a rejected duplicate does not replace the incumbent", () => {
    registerTracked("dag182-incumbent");
    const before = reg.list().filter((id) => id === "dag182-incumbent").length;

    expect(() => reg.register("dag182-incumbent")).toThrow(ConfigError);

    expect(before).toBe(1);
    expect(reg.list().filter((id) => id === "dag182-incumbent")).toHaveLength(1);
  });

  it("get() throws ConfigError for an unknown id", () => {
    expect(() => reg.getId("dag182-never-registered")).toThrow(ConfigError);
  });

  it("get() names the known adapters in its error, so the message is actionable", () => {
    registerTracked("dag182-listed-in-error");

    expect(() => reg.getId("dag182-absent")).toThrow(/dag182-listed-in-error/);
  });

  it("has() is false for an unknown id", () => {
    expect(reg.has("dag182-never-registered")).toBe(false);
  });

  it("unregister() removes an adapter and frees its id for re-registration", () => {
    reg.register("dag182-unregister");
    expect(reg.has("dag182-unregister")).toBe(true);

    reg.unregister("dag182-unregister");

    expect(reg.has("dag182-unregister")).toBe(false);
    expect(reg.list()).not.toContain("dag182-unregister");
    expect(() => reg.getId("dag182-unregister")).toThrow(ConfigError);
    expect(() => reg.register("dag182-unregister")).not.toThrow();
    reg.unregister("dag182-unregister");
  });

  it("unregister() is a no-op for an id that was never registered", () => {
    const before = reg.list().length;

    expect(() => reg.unregister("dag182-never-registered")).not.toThrow();

    expect(reg.list()).toHaveLength(before);
  });

  it("list() reflects registrations without disturbing the built-ins", () => {
    const before = reg.list();
    registerTracked("dag182-list");

    const after = reg.list();

    expect(after).toEqual([...before, "dag182-list"]);
  });
});
