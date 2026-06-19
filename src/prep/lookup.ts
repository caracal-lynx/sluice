// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * PrepLookupResolver — same shape as transform.LookupResolver but
 * intentionally a separate class with a separate cache instance.
 *
 * The v1 spec keeps prep and transform lookups isolated (see
 * docs/PHASE-12-prep-phase-spec.md → "Open questions"). If duplication
 * becomes painful in real client pipelines, a shared cache can be
 * retro-fitted without changing this interface.
 *
 * Unlike transform.LookupResolver this class takes the lookups array
 * directly rather than the full pipeline config, so the same machinery
 * is reusable for any caller that wants a self-contained lookup cache.
 */

import { SourceAdapterRegistry } from "../adapters/source/index.js";
import type { Lookup, RunConfig } from "../config/types.js";
import { StagingStore, quoteIdent } from "../staging/index.js";
import { PrepError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { stringifyValue } from "../utils/stringify.js";

export class PrepLookupResolver {
  private readonly tables = new Map<string, Map<string, string>>();

  async loadAll(lookups: Lookup[], runConfig: RunConfig): Promise<void> {
    for (const lookup of lookups) {
      if (this.tables.has(lookup.name)) {
        throw new PrepError(`Duplicate prep lookup name: "${lookup.name}"`);
      }

      const adapter = SourceAdapterRegistry.get(lookup.source.adapter);
      const tempStore = new StagingStore(":memory:");
      await tempStore.open();
      try {
        await adapter.connect(lookup.source);
        try {
          await adapter.extract(lookup.source, tempStore, runConfig, () => {}, "stg_prep_lookup");
        } finally {
          await adapter.disconnect();
        }

        const rows = await tempStore.query<Record<string, unknown>>(
          `SELECT ${quoteIdent(lookup.key)} AS k, ${quoteIdent(lookup.value)} AS v FROM stg_prep_lookup`,
        );
        const map = new Map<string, string>();
        for (const row of rows) {
          const k = row["k"];
          const v = row["v"];
          if (k === null || k === undefined) continue;
          map.set(stringifyValue(k), v === null || v === undefined ? "" : stringifyValue(v));
        }
        this.tables.set(lookup.name, map);
        logger.debug({ lookup: lookup.name, entries: map.size }, "prep lookup: loaded");
      } finally {
        await tempStore.close();
      }
    }
  }

  /** Returns the resolved value, or undefined on miss. */
  resolve(lookupName: string, key: unknown): string | undefined {
    const table = this.tables.get(lookupName);
    if (!table) {
      throw new PrepError(`Unknown prep lookup: "${lookupName}"`);
    }
    if (key === null || key === undefined || key === "") return undefined;
    return table.get(stringifyValue(key));
  }

  /** Primarily for tests. */
  getTable(name: string): ReadonlyMap<string, string> | undefined {
    return this.tables.get(name);
  }
}
