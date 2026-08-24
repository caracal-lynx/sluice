// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * DAG-336: `TargetAd` advertised `rest` while no rest target adapter was
 * registered, so `sluice check` passed and the run died at load — after a full
 * extract and transform. These tests are the guard: the config enums and the
 * adapter registries must name exactly the same adapters.
 */

import { describe, it, expect } from "vitest";

import { SourceAd, TargetAd, TargetSchema } from "../../../src/config/schema.js";
import { SourceAdapterRegistry } from "../../../src/adapters/source/index.js";
import { TargetAdapterRegistry } from "../../../src/adapters/target/index.js";

describe("adapter enum / registry parity", () => {
  it("every target adapter the schema accepts is registered", () => {
    expect([...TargetAd.options].sort()).toEqual([...TargetAdapterRegistry.list()].sort());
  });

  it("every source adapter the schema accepts is registered", () => {
    expect([...SourceAd.options].sort()).toEqual([...SourceAdapterRegistry.list()].sort());
  });

  it("rejects `rest` as a target adapter at parse time", () => {
    expect(TargetSchema.safeParse({ adapter: "rest" }).success).toBe(false);
  });
});
