// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * LookupResolver — preloads every `transform.lookups[]` entry into an
 * in-memory Map<string, string> keyed by name. Values stringified.
 *
 * Each lookup entry has its own `source` config (any source adapter works),
 * so this resolver re-uses the global SourceAdapterRegistry to extract the
 * lookup table into a temporary `:memory:` staging store, then copies the
 * key/value pairs into the cache.
 */

import { SourceAdapterRegistry } from "../adapters/source/index.js";
import type { Pipeline, RunConfig } from "../config/types.js";
import { StagingStore, quoteIdent } from "../staging/index.js";
import { TransformError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { stringifyValue } from "../utils/stringify.js";

export class LookupResolver {
  private readonly tables = new Map<string, Map<string, string>>();

  async loadAll(config: Pipeline, runConfig: RunConfig): Promise<void> {
    for (const lookup of config.transform.lookups) {
      if (this.tables.has(lookup.name)) {
        throw new TransformError(`Duplicate lookup name: "${lookup.name}"`);
      }

      const adapter = SourceAdapterRegistry.get(lookup.source.adapter);
      const tempStore = new StagingStore(":memory:");
      await tempStore.open();
      try {
        await adapter.connect(lookup.source);
        try {
          await adapter.extract(lookup.source, tempStore, runConfig, () => {}, "stg_lookup");
        } finally {
          await adapter.disconnect();
        }

        const rows = await tempStore.query<Record<string, unknown>>(
          `SELECT ${quoteIdent(lookup.key)} AS k, ${quoteIdent(lookup.value)} AS v FROM stg_lookup`,
        );
        const map = new Map<string, string>();
        for (const row of rows) {
          const k = row["k"];
          const v = row["v"];
          if (k === null || k === undefined) continue;
          map.set(stringifyValue(k), v === null || v === undefined ? "" : stringifyValue(v));
        }
        this.tables.set(lookup.name, map);
        logger.debug({ lookup: lookup.name, entries: map.size }, "lookup: loaded");
      } finally {
        await tempStore.close();
      }
    }
  }

  /** Returns the resolved value, or undefined on miss. */
  resolve(lookupName: string, key: unknown): string | undefined {
    const table = this.tables.get(lookupName);
    if (!table) {
      throw new TransformError(`Unknown lookup: "${lookupName}"`);
    }
    if (key === null || key === undefined || key === "") return undefined;
    return table.get(stringifyValue(key));
  }

  /** Primarily for tests. */
  getTable(name: string): ReadonlyMap<string, string> | undefined {
    return this.tables.get(name);
  }
}
