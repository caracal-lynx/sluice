// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * REST source adapter.
 *
 * - axios + axios-retry (3 retries, exponential backoff, 429 + 5xx)
 * - Flattens nested JSON objects using `__` separator (`a.b` → `a__b`)
 * - Three pagination styles supported: offset, page, cursor
 * - `targetTable` defaults to 'stg_raw'.
 */

import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import axiosRetry from "axios-retry";

import type { RunConfig, SourceConfig } from "../../config/types.js";
import type { ColumnMeta, StagingStore } from "../../staging/index.js";
import { SourceError } from "../../utils/errors.js";
import { collectColumns, flatten, getPath } from "../../utils/flatten.js";
import { logger } from "../../utils/logger.js";
import { stringifyValue } from "../../utils/stringify.js";
import type { ExtractResult, SourceAdapter } from "./types.js";

type Source = SourceConfig;
type PaginationConfig = NonNullable<SourceConfig["pagination"]>;

export class RestSourceAdapter implements SourceAdapter {
  readonly id = "rest";
  private client: AxiosInstance | null = null;

  async connect(config: Source): Promise<void> {
    // No I/O on connect (the client is created lazily-free here), but the
    // SourceAdapter contract is async and validation errors must surface as a
    // rejected promise — keep the method genuinely async.
    await Promise.resolve();
    if (!config.endpoint) {
      throw new SourceError("rest source requires `endpoint`");
    }
    const axiosCfg: AxiosRequestConfig = { timeout: 30000 };
    if (config.headers) axiosCfg.headers = config.headers;
    const client = axios.create(axiosCfg);
    axiosRetry(client, {
      retries: 3,
      retryDelay: (retryCount, err) => axiosRetry.exponentialDelay(retryCount, err),
      retryCondition: (err) => {
        const status = err.response?.status;
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(err) ||
          status === 429 ||
          (status !== undefined && status >= 500)
        );
      },
    });
    this.client = client;
  }

  async disconnect(): Promise<void> {
    await Promise.resolve();
    this.client = null;
  }

  async extract(
    config: Source,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
    targetTable = "stg_raw",
  ): Promise<ExtractResult> {
    if (!config.endpoint) throw new SourceError("rest source requires `endpoint`");
    if (!this.client) throw new SourceError("rest: not connected");

    const pagination = config.pagination;
    let allRecords: Record<string, unknown>[] = [];

    if (!pagination) {
      allRecords = await this.fetchOne(config.endpoint, config, undefined);
    } else {
      allRecords = await this.fetchPaged(config.endpoint, config, pagination);
    }

    if (allRecords.length === 0) {
      throw new SourceError(`rest endpoint "${config.endpoint}" returned zero records`);
    }

    const flatRecords = allRecords.map((r) => flatten(r));
    const columns: ColumnMeta[] = collectColumns(flatRecords);
    await store.createTable(targetTable, columns);

    for (let i = 0; i < flatRecords.length; i += runConfig.batchSize) {
      const batch = flatRecords.slice(i, i + runConfig.batchSize);
      await store.insertBatch(targetTable, batch);
      onProgress(Math.min(i + batch.length, flatRecords.length));
    }

    return { rowsExtracted: flatRecords.length, tableName: targetTable, columns };
  }

  private async fetchOne(
    endpoint: string,
    config: Source,
    params: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>[]> {
    const body = await this.get(endpoint, params);
    const dataField = config.pagination?.dataField;
    const data = dataField ? getPath(body, dataField) : body;
    if (!Array.isArray(data)) {
      throw new SourceError(
        `rest: expected an array at dataField "${dataField ?? "(root)"}", got ${typeof data}`,
      );
    }
    return data as Record<string, unknown>[];
  }

  private async fetchPaged(
    endpoint: string,
    config: Source,
    pagination: PaginationConfig,
  ): Promise<Record<string, unknown>[]> {
    const pageSize = pagination.pageSize;
    const dataField = pagination.dataField ?? "data";
    const pageParam = pagination.pageParam ?? "page";
    const totalField = pagination.totalField;

    const all: Record<string, unknown>[] = [];
    let page = 0;
    let offset = 0;
    let cursor: string | undefined;
    let total: number | undefined;

    while (true) {
      const params: Record<string, unknown> = {};
      if (pagination.type === "offset") {
        params[pageParam] = offset;
        params["limit"] = pageSize;
      } else if (pagination.type === "page") {
        params[pageParam] = page + 1;
        params["pageSize"] = pageSize;
      } else {
        if (cursor !== undefined) {
          const cursorParam = pagination.cursorParam ?? "cursor";
          params[cursorParam] = cursor;
        }
      }

      const body = await this.get(endpoint, params);
      const chunk = getPath(body, dataField);
      if (!Array.isArray(chunk)) {
        throw new SourceError(`rest: expected array at dataField "${dataField}" on page ${page}`);
      }
      all.push(...(chunk as Record<string, unknown>[]));

      if (total === undefined && totalField) {
        const t = getPath(body, totalField);
        if (typeof t === "number") total = t;
      }

      if (chunk.length === 0) break;
      if (pagination.type === "offset") {
        offset += chunk.length;
        if (total !== undefined && offset >= total) break;
        if (chunk.length < pageSize) break;
      } else if (pagination.type === "page") {
        page += 1;
        if (total !== undefined && all.length >= total) break;
        if (chunk.length < pageSize) break;
      } else {
        const cursorField = pagination.cursorField;
        if (!cursorField) {
          throw new SourceError("rest: cursor pagination requires `pagination.cursorField`");
        }
        const next = getPath(body, cursorField);
        if (next === null || next === undefined || next === "") break;
        cursor = stringifyValue(next);
      }
    }

    logger.debug({ total: all.length, pagination: pagination.type }, "rest: paged fetch complete");
    return all;
  }

  private async get(url: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    try {
      const res = await this.client!.get(url, { params });
      return res.data;
    } catch (err) {
      throw new SourceError(
        `rest: GET ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
