// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * IFS ERP target adapter.
 *
 * IFS bulk import expects a UTF-8 CSV, typically without a header row, with
 * columns in a fixed order the downstream loader understands. This adapter
 * emits the CSV via DuckDB's COPY with an explicit SELECT list when
 * `columnOrder` is set.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { RunConfig, TargetConfig } from "../../config/types.js";
import { quoteIdent, type StagingStore } from "../../staging/index.js";
import { LoadError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import type { LoadResult, TargetAdapter } from "./types.js";

const STAGING_TABLE = "stg_transformed";

export class IfsTargetAdapter implements TargetAdapter {
  readonly id = "ifs";

  async connect(_config: TargetConfig): Promise<void> {
    // Nothing to establish.
  }

  async disconnect(): Promise<void> {
    // Nothing to release.
  }

  async load(
    config: TargetConfig,
    store: StagingStore,
    _runConfig: RunConfig,
    onProgress: (rows: number) => void,
  ): Promise<LoadResult> {
    if (!config.output) {
      throw new LoadError("ifs target requires `output`");
    }
    const outputPath = path.resolve(config.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const includeHeader = config.includeHeader ?? false; // IFS default: no header
    const rowsLoaded = await store.rowCount(STAGING_TABLE);
    const allColumns = await store.columnNames(STAGING_TABLE);

    let orderedColumns: string[];
    if (config.columnOrder && config.columnOrder.length > 0) {
      const missing = config.columnOrder.filter((c) => !allColumns.includes(c));
      if (missing.length > 0) {
        throw new LoadError(
          `ifs: columnOrder references columns not present in stg_transformed: ${missing.join(", ")}`,
        );
      }
      orderedColumns = config.columnOrder;
    } else {
      orderedColumns = allColumns;
    }

    const safePath = outputPath.replace(/\\/g, "/").replace(/'/g, "''");
    const safeDelim = (config.delimiter ?? ",").replace(/'/g, "''");
    const safeNull = config.nullValue.replace(/'/g, "''");
    const selectList = orderedColumns.map(quoteIdent).join(", ");

    await store.query(
      `COPY (SELECT ${selectList} FROM ${quoteIdent(STAGING_TABLE)}) TO '${safePath}' (HEADER ${includeHeader ? "TRUE" : "FALSE"}, DELIMITER '${safeDelim}', NULL '${safeNull}')`,
    );

    onProgress(rowsLoaded);
    logger.debug(
      { outputPath, rowsLoaded, columns: orderedColumns.length },
      "ifs target: load complete",
    );

    return { rowsLoaded, rowsFailed: 0, outputPath };
  }
}
