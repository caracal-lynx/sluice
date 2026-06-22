import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => {
  const post = vi.fn();
  const patch = vi.fn();
  const instance = {
    post,
    patch,
    get: vi.fn(),
    defaults: { headers: {} },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  const create = vi.fn(() => instance);
  // Provide isAxiosError helper to match the real axios behaviour
  const isAxiosError = (err: unknown): boolean =>
    !!(typeof err === "object" && err !== null && (err as { isAxiosError?: boolean }).isAxiosError);
  return { default: { create, isAxiosError, __post: post, __patch: patch, __instance: instance } };
});

const axiosMod = (await import("axios")) as unknown as {
  default: { __post: ReturnType<typeof vi.fn>; __patch: ReturnType<typeof vi.fn> };
};
const { BcTokenManager, BcTargetAdapter } = await import("../../../../src/adapters/target/bc.js");
const { StagingStore } = await import("../../../../src/staging/index.js");
const { LoadError, ConfigError } = await import("../../../../src/utils/errors.js");

import type { RunConfig, TargetConfig } from "../../../../src/config/types.js";

const BASE_RUN: RunConfig = {
  mode: "full",
  batchSize: 500,
  onError: "continue",
  logLevel: "info",
  dryRun: false,
  outputDir: "./output",
  stagingDb: "",
};

function bcTarget(overrides: Partial<TargetConfig> = {}): TargetConfig {
  return {
    adapter: "bc",
    baseUrl: "https://api.bc.example/v2.0",
    company: "ACME",
    entity: "customers",
    apiVersion: "v2.0",
    onConflict: "fail",
    batchEndpoint: true,
    delimiter: ",",
    encoding: "utf-8",
    nullValue: "",
    schema: "public",
    ...overrides,
  } as TargetConfig;
}

describe("BcTokenManager", () => {
  beforeEach(() => {
    process.env["BC_TENANT_ID"] = "tenant";
    process.env["BC_CLIENT_ID"] = "client";
    process.env["BC_CLIENT_SECRET"] = "secret";
    axiosMod.default.__post.mockReset();
  });

  it("acquires a token and caches it", async () => {
    axiosMod.default.__post.mockResolvedValueOnce({
      data: { access_token: "tok-1", expires_in: 3600 },
    });
    const mgr = new BcTokenManager();
    const t1 = await mgr.getToken();
    const t2 = await mgr.getToken();
    expect(t1).toBe("tok-1");
    expect(t2).toBe("tok-1");
    expect(axiosMod.default.__post).toHaveBeenCalledTimes(1); // cached
  });

  it("throws LoadError if token response is malformed", async () => {
    axiosMod.default.__post.mockResolvedValueOnce({ data: {} });
    const mgr = new BcTokenManager();
    await expect(mgr.getToken()).rejects.toBeInstanceOf(LoadError);
  });
});

describe("BcTargetAdapter", () => {
  let store: InstanceType<typeof StagingStore>;

  beforeEach(async () => {
    store = new StagingStore(":memory:");
    await store.open();
    await store.createTable("stg_transformed", [
      { name: "No", duckDbType: "VARCHAR" },
      { name: "Name", duckDbType: "VARCHAR" },
    ]);
    await store.insertBatch("stg_transformed", [
      { No: "C1", Name: "Alice" },
      { No: "C2", Name: "Bob" },
    ]);
    process.env["BC_TENANT_ID"] = "tenant";
    process.env["BC_CLIENT_ID"] = "client";
    process.env["BC_CLIENT_SECRET"] = "secret";
    axiosMod.default.__post.mockReset();
    axiosMod.default.__patch.mockReset();
  });

  afterEach(async () => {
    await store.close();
  });

  it("throws ConfigError without baseUrl/company/entity", async () => {
    const adapter = new BcTargetAdapter();
    await expect(adapter.connect(bcTarget({ baseUrl: undefined }))).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("loads rows via $batch and counts 2xx responses as successes", async () => {
    axiosMod.default.__post
      .mockResolvedValueOnce({ data: { access_token: "tok", expires_in: 3600 } }) // token
      .mockResolvedValueOnce({
        data: "--boundary\r\nHTTP/1.1 201 Created\r\n\r\n--boundary\r\nHTTP/1.1 201 Created\r\n\r\n--boundary--\r\n",
      });
    const adapter = new BcTargetAdapter();
    const target = bcTarget();
    await adapter.connect(target);
    const result = await adapter.load(target, store, BASE_RUN, () => {});
    expect(result.rowsLoaded).toBe(2);
    expect(result.rowsFailed).toBe(0);
  });

  it("tallies failed sub-responses when 2xx are fewer than rows", async () => {
    axiosMod.default.__post
      .mockResolvedValueOnce({ data: { access_token: "tok", expires_in: 3600 } })
      .mockResolvedValueOnce({
        data: "--b\r\nHTTP/1.1 201 Created\r\n\r\n--b\r\nHTTP/1.1 400 Bad Request\r\n\r\n--b--\r\n",
      });
    const adapter = new BcTargetAdapter();
    const target = bcTarget();
    await adapter.connect(target);
    const result = await adapter.load(target, store, BASE_RUN, () => {});
    expect(result.rowsLoaded).toBe(1);
    expect(result.rowsFailed).toBe(1);
  });
});
