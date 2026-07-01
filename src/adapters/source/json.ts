// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * JSON file source adapter.
 *
 * - Reads a single local JSON file (no HTTP — that's the `rest` adapter).
 * - `recordPath` is an optional dot-path to the records array inside the file
 *   (`data.items`). Omit it when the file's root is already an array.
 * - Nested objects are flattened with `__` (shared with `rest`); arrays land as
 *   JSON text. All columns are VARCHAR (staging is untyped text).
 * - `targetTable` defaults to 'stg_raw'; `MultiSourcePipelineRunner` overrides it.
 *
 * Motivating case: ingesting dated Legitify posture-scan JSON into a trend table
 * (DAG-95). Legitify's raw output is an object keyed by policy, so a small
 * reshape step explodes it into a findings array first — see
 * examples/legitify-findings/.
 */

import { readFileSync } from "node:fs";

import type { RunConfig, SourceConfig } from "../../config/types.js";
import type { ColumnMeta, StagingStore } from "../../staging/index.js";
import { SourceError } from "../../utils/errors.js";
import { collectColumns, flatten, getPath } from "../../utils/flatten.js";
import { logger } from "../../utils/logger.js";
import type { ExtractResult, SourceAdapter } from "./types.js";

export class JsonSourceAdapter implements SourceAdapter {
  readonly id = "json";

  async connect(_config: SourceConfig): Promise<void> {
    // JSON is file-based; no persistent connection to establish.
    await Promise.resolve();
  }

  async disconnect(): Promise<void> {
    await Promise.resolve();
  }

  async extract(
    config: SourceConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
    targetTable = "stg_raw",
  ): Promise<ExtractResult> {
    if (!config.file) {
      throw new SourceError("json source requires `file`");
    }

    let raw: string;
    try {
      raw = readFileSync(config.file, { encoding: config.encoding as BufferEncoding });
    } catch (err) {
      throw new SourceError(`json: could not read "${config.file}"`, err);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new SourceError(`json: "${config.file}" is not valid JSON`, err);
    }

    const node = config.recordPath ? getPath(parsed, config.recordPath) : parsed;
    if (!Array.isArray(node)) {
      throw new SourceError(
        `json: expected an array at recordPath "${config.recordPath ?? "(root)"}" in "${config.file}", got ${node === undefined ? "undefined" : typeof node}`,
      );
    }
    if (node.length === 0) {
      // Consistent with the csv/rest adapters: a VARCHAR staging schema can't be
      // inferred from zero rows. A genuinely empty result (e.g. a clean Legitify
      // week) is an orchestration concern — skip ingest rather than run this.
      throw new SourceError(`json: "${config.file}" produced no records`);
    }

    const flatRecords = node.map((r, i) => {
      if (r === null || typeof r !== "object" || Array.isArray(r)) {
        const got = r === null ? "null" : Array.isArray(r) ? "array" : typeof r;
        throw new SourceError(
          `json: record ${i} in "${config.file}" is not an object (got ${got}); the records array must contain objects`,
        );
      }
      return flatten(r as Record<string, unknown>);
    });
    const columns: ColumnMeta[] = collectColumns(flatRecords);
    await store.createTable(targetTable, columns);
    logger.debug({ file: config.file, rows: flatRecords.length, targetTable }, "json: loaded file");

    for (let i = 0; i < flatRecords.length; i += runConfig.batchSize) {
      const batch = flatRecords.slice(i, i + runConfig.batchSize);
      await store.insertBatch(targetTable, batch);
      onProgress(Math.min(i + batch.length, flatRecords.length));
    }

    return { rowsExtracted: flatRecords.length, tableName: targetTable, columns };
  }
}
