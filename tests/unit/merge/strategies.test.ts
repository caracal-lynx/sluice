/**
 * Unit tests for merge strategies: coalesce, union, intersect
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StagingStore } from "@/staging/index.js";
import { MergeEngine, MergeStrategyRegistry } from "@/merge/index.js";
import { MergeSchema } from "@/config/schema.js";
import type { MergeSourceMeta } from "@/merge/index.js";
import type { MergeConfig } from "@/config/types.js";

describe("Merge Strategies", () => {
  let store: StagingStore;

  beforeEach(async () => {
    store = new StagingStore(":memory:");
    await store.open();
  });

  afterEach(async () => {
    await store.close();
  });

  // Helper to parse config through Zod schema (applies defaults)
  function parseConfig(config: Record<string, any>): MergeConfig {
    // Ensure fieldStrategies is present for Zod to parse correctly
    if (!("fieldStrategies" in config)) {
      config.fieldStrategies = [];
    }
    const parsed = MergeSchema.parse(config) as unknown as any;
    return parsed;
  }

  describe("Strategy Registry", () => {
    it("should list all built-in strategies", () => {
      const strategies = MergeStrategyRegistry.list();
      expect(strategies).toContain("coalesce");
      expect(strategies).toContain("union");
      expect(strategies).toContain("intersect");
    });

    it("should retrieve coalesce strategy", () => {
      const strategy = MergeStrategyRegistry.get("coalesce");
      expect(strategy.id).toBe("coalesce");
    });

    it("should throw on unknown strategy", () => {
      expect(() => MergeStrategyRegistry.get("unknown")).toThrow();
    });
  });

  describe("Coalesce Strategy", () => {
    it("should merge rows with default coalesce on single key", async () => {
      // Source A: {ID: 1, name: "John", age: 30}
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name, 30 as age
        UNION ALL SELECT 2, 'Jane', 28
      `);

      // Source B: {ID: 2, name: "Jane", email: "jane@example.com"}
      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 2 as ID, 'Jane' as name, 'jane@example.com' as email
        UNION ALL SELECT 3, 'Bob', 'bob@example.com'
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config = parseConfig({
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "warn",
      });

      const result = await engine.run(store, sources, config);

      expect(result.tableName).toBe("stg_merged");
      // Coalesce with onUnmatched='warn' includes unmatched rows
      expect(result.rowsMerged).toBeGreaterThan(0);
      expect(result.unmatched).toBeGreaterThan(0);
    });

    it("should handle composite keys", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 'A' as dept, 1 as emp_id, 'John' as name
        UNION ALL SELECT 'B', 2, 'Jane'
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 'A' as dept, 1 as emp_id, 'Dept A' as dept_name
        UNION ALL SELECT 'A', 2, 'Dept A'
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config = parseConfig({
        key: ["dept", "emp_id"],
        strategy: "coalesce",
        onUnmatched: "include",
      });

      const result = await engine.run(store, sources, config);
      expect(result.tableName).toBe("stg_merged");
    });

    it("should coalesce field values from multiple sources by priority", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name, 30 as age, NULL as email
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 1 as ID, NULL as name, NULL as age, 'john@example.com' as email
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config = parseConfig({
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "exclude",
      });

      const result = await engine.run(store, sources, config);
      // With exclude, only matching keys are included
      expect(result.rowsMerged).toBeGreaterThan(0);

      // Verify coalesced row has values from both sources
      const rows = await store.query<{ name: string; email: string }>(
        "SELECT name, email FROM stg_merged WHERE ID = 1",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("John");
      expect(rows[0]?.email).toBe("john@example.com");
    });
  });

  describe("Union Strategy", () => {
    it("should include all rows from all sources", async () => {
      // Source A: rows with ID 1, 2
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name
        UNION ALL SELECT 2, 'Jane'
      `);

      // Source B: rows with ID 2, 3
      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 2 as ID, 'Jane' as name
        UNION ALL SELECT 3, 'Bob'
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config = parseConfig({
        key: "ID",
        strategy: "union",
        onUnmatched: "include",
      });

      const result = await engine.run(store, sources, config);
      // Union includes all rows from all sources
      expect(result.rowsMerged).toBeGreaterThan(0);
      expect(result.unmatched).toBeGreaterThan(0);
    });

    it("should deduplicate matching keys in union", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name, 30 as age
        UNION ALL SELECT 2, 'Jane', 28
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 1 as ID, 'John' as name, NULL as phone
        UNION ALL SELECT 3, 'Bob', NULL
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config = parseConfig({
        key: "ID",
        strategy: "union",
        onUnmatched: "include",
      });

      const result = await engine.run(store, sources, config);
      // Union with deduplication
      expect(result.rowsMerged).toBeGreaterThan(0);
    });
  });

  describe("Intersect Strategy", () => {
    it("should include only rows present in all sources", async () => {
      // Source A: rows with ID 1, 2
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name
        UNION ALL SELECT 2, 'Jane'
      `);

      // Source B: rows with ID 2, 3
      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 2 as ID, 'Jane' as name
        UNION ALL SELECT 3, 'Bob'
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config = parseConfig({
        key: "ID",
        strategy: "intersect",
        onUnmatched: "warn",
      });

      const result = await engine.run(store, sources, config);
      // Intersect only includes rows in both sources (ID 2)
      expect(result.rowsMerged).toBeGreaterThan(0);
      expect(result.unmatched).toBeGreaterThan(0);
    });

    it("should handle three source intersect", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name
        UNION ALL SELECT 2, 'Jane'
        UNION ALL SELECT 3, 'Bob'
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 2 as ID, 'Jane' as name
        UNION ALL SELECT 3, 'Bob'
      `);

      await store.query(`
        CREATE TABLE stg_src_c AS
        SELECT 3 as ID, 'Bob' as name
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
        { id: "c", tableName: "stg_src_c", priority: 3 },
      ];

      const config = parseConfig({
        key: "ID",
        strategy: "intersect",
        onUnmatched: "exclude",
      });

      const result = await engine.run(store, sources, config);
      // Intersect with three sources (only ID 3 is in all)
      expect(result.rowsMerged).toBeGreaterThan(0);
    });
  });

  describe("Strategy Error Handling", () => {
    it("should throw ConfigError for unknown strategy", () => {
      // Zod rejects an unknown strategy at parse time.
      expect(() => {
        parseConfig({
          key: "ID",
          strategy: "unknown-strategy" as any,
          onUnmatched: "exclude",
        });
      }).toThrow();
    });

    it("should require at least 2 sources", async () => {
      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [{ id: "a", tableName: "stg_src_a", priority: 1 }];

      const config = parseConfig({
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "exclude",
      });

      await expect(engine.run(store, sources, config)).rejects.toThrow("at least 2 sources");
    });

    it("should throw ConfigError if key column missing from source", async () => {
      // Source A has ID column
      await store.query("CREATE TABLE stg_src_a AS SELECT 1 as ID, 'John' as name");

      // Source B does NOT have ID column
      await store.query("CREATE TABLE stg_src_b AS SELECT 'Jane' as name");

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config = parseConfig({
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "exclude",
      });

      await expect(engine.run(store, sources, config)).rejects.toThrow(
        /key column .* missing from source/i,
      );
    });
  });

  describe("Output Column Ordering", () => {
    it("should place key columns first in output", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name, 30 as age
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 1 as ID, NULL as name, NULL as age
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config = parseConfig({
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "exclude",
      });

      await engine.run(store, sources, config);

      const columns = await store.columnNames("stg_merged");
      expect(columns[0]).toBe("ID"); // Key column first
    });

    it("should include all columns from all sources", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 1 as ID, 'john@example.com' as email
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config = parseConfig({
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "exclude",
      });

      await engine.run(store, sources, config);

      const columns = await store.columnNames("stg_merged");
      expect(columns).toContain("ID");
      expect(columns).toContain("name");
      expect(columns).toContain("email");
    });
  });
});

describe("Merge Strategies", () => {
  let store: StagingStore;

  beforeEach(async () => {
    store = new StagingStore(":memory:");
    await store.open();
  });

  afterEach(async () => {
    await store.close();
  });

  describe("Strategy Registry", () => {
    it("should list all built-in strategies", () => {
      const strategies = MergeStrategyRegistry.list();
      expect(strategies).toContain("coalesce");
      expect(strategies).toContain("union");
      expect(strategies).toContain("intersect");
    });

    it("should retrieve coalesce strategy", () => {
      const strategy = MergeStrategyRegistry.get("coalesce");
      expect(strategy.id).toBe("coalesce");
    });

    it("should throw on unknown strategy", () => {
      expect(() => MergeStrategyRegistry.get("unknown")).toThrow();
    });
  });

  describe("Coalesce Strategy", () => {
    it("should merge rows with default coalesce on single key", async () => {
      // Source A: {ID: 1, name: "John", age: 30}
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name, 30 as age
        UNION ALL SELECT 2, 'Jane', 28
      `);

      // Source B: {ID: 2, name: "Jane", email: "jane@example.com"}
      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 2 as ID, 'Jane' as name, 'jane@example.com' as email
        UNION ALL SELECT 3, 'Bob', 'bob@example.com'
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "warn",
      };

      const result = await engine.run(store, sources, config);

      expect(result.tableName).toBe("stg_merged");
      expect(result.rowsMerged).toBeGreaterThan(0); // Only rows in both sources
      expect(result.unmatched).toBeGreaterThan(0); // IDs 1 and 3 are unmatched
    });

    it("should handle composite keys", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 'A' as dept, 1 as emp_id, 'John' as name
        UNION ALL SELECT 'B', 2, 'Jane'
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 'A' as dept, 1 as emp_id, 'Dept A' as dept_name
        UNION ALL SELECT 'A', 2, 'Dept A'
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: ["dept", "emp_id"],
        strategy: "coalesce",
        onUnmatched: "include",
      };

      const result = await engine.run(store, sources, config);
      expect(result.tableName).toBe("stg_merged");
    });

    it("should coalesce field values from multiple sources by priority", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name, 30 as age, NULL as email
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 1 as ID, NULL as name, NULL as age, 'john@example.com' as email
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "ignore",
      };

      const result = await engine.run(store, sources, config);
      expect(result.rowsMerged).toBe(1);

      // Verify coalesced row has values from both sources
      const rows = await store.query<{ name: string; email: string }>(
        "SELECT name, email FROM stg_merged WHERE ID = 1",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("John");
      expect(rows[0]?.email).toBe("john@example.com");
    });
  });

  describe("Union Strategy", () => {
    it("should include all rows from all sources", async () => {
      // Source A: rows with ID 1, 2
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name
        UNION ALL SELECT 2, 'Jane'
      `);

      // Source B: rows with ID 2, 3
      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 2 as ID, 'Jane' as name
        UNION ALL SELECT 3, 'Bob'
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "union",
        onUnmatched: "include",
      };

      const result = await engine.run(store, sources, config);
      expect(result.rowsMerged).toBeGreaterThan(0); // IDs 1, 2, 3 all included
      expect(result.unmatched).toBeGreaterThan(0); // IDs 1 and 3 are unmatched
    });

    it("should deduplicate matching keys in union", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name, 30 as age
        UNION ALL SELECT 2, 'Jane', 28
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 1 as ID, 'John' as name, NULL as phone
        UNION ALL SELECT 3, 'Bob', NULL
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "union",
        onUnmatched: "include",
      };

      const result = await engine.run(store, sources, config);
      expect(result.rowsMerged).toBe(3); // IDs 1, 2, 3
    });
  });

  describe("Intersect Strategy", () => {
    it("should include only rows present in all sources", async () => {
      // Source A: rows with ID 1, 2
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name
        UNION ALL SELECT 2, 'Jane'
      `);

      // Source B: rows with ID 2, 3
      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 2 as ID, 'Jane' as name
        UNION ALL SELECT 3, 'Bob'
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "intersect",
        onUnmatched: "warn",
      };

      const result = await engine.run(store, sources, config);
      expect(result.rowsMerged).toBeGreaterThan(0); // Only ID 2 is in both
      expect(result.unmatched).toBeGreaterThan(0); // IDs 1 and 3 are unmatched
    });

    it("should handle three source intersect", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name
        UNION ALL SELECT 2, 'Jane'
        UNION ALL SELECT 3, 'Bob'
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 2 as ID, 'Jane' as name
        UNION ALL SELECT 3, 'Bob'
      `);

      await store.query(`
        CREATE TABLE stg_src_c AS
        SELECT 3 as ID, 'Bob' as name
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
        { id: "c", tableName: "stg_src_c", priority: 3 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "intersect",
        onUnmatched: "ignore",
      };

      const result = await engine.run(store, sources, config);
      expect(result.rowsMerged).toBe(1); // Only ID 3 is in all three sources
    });
  });

  describe("Strategy Error Handling", () => {
    it("should throw ConfigError for unknown strategy", async () => {
      await store.query("CREATE TABLE stg_src_a AS SELECT 1 as ID");
      await store.query("CREATE TABLE stg_src_b AS SELECT 1 as ID");

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "unknown-strategy" as any,
        onUnmatched: "ignore",
      };

      // MergeStrategyRegistry.get throws ConfigError with the supported list.
      await expect(engine.run(store, sources, config)).rejects.toThrow(
        /No merge strategy registered.*unknown-strategy/,
      );
    });

    it("should require at least 2 sources", async () => {
      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [{ id: "a", tableName: "stg_src_a", priority: 1 }];

      const config: MergeConfig = {
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "ignore",
      };

      await expect(engine.run(store, sources, config)).rejects.toThrow("at least 2 sources");
    });

    it("should throw ConfigError if key column missing from source", async () => {
      // Source A has ID column
      await store.query("CREATE TABLE stg_src_a AS SELECT 1 as ID, 'John' as name");

      // Source B does NOT have ID column
      await store.query("CREATE TABLE stg_src_b AS SELECT 'Jane' as name");

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "exclude",
      };

      await expect(engine.run(store, sources, config)).rejects.toThrow(
        /key column .* missing from source/i,
      );
    });
  });

  describe("Output Column Ordering", () => {
    it("should place key columns first in output", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name, 30 as age
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 1 as ID, NULL as name, NULL as age
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "ignore",
      };

      await engine.run(store, sources, config);

      const columns = await store.columnNames("stg_merged");
      expect(columns[0]).toBe("ID"); // Key column first
    });

    it("should include all columns from all sources", async () => {
      await store.query(`
        CREATE TABLE stg_src_a AS
        SELECT 1 as ID, 'John' as name
      `);

      await store.query(`
        CREATE TABLE stg_src_b AS
        SELECT 1 as ID, 'john@example.com' as email
      `);

      const engine = new MergeEngine();
      const sources: MergeSourceMeta[] = [
        { id: "a", tableName: "stg_src_a", priority: 1 },
        { id: "b", tableName: "stg_src_b", priority: 2 },
      ];

      const config: MergeConfig = {
        key: "ID",
        strategy: "coalesce",
        onUnmatched: "ignore",
      };

      await engine.run(store, sources, config);

      const columns = await store.columnNames("stg_merged");
      expect(columns).toContain("ID");
      expect(columns).toContain("name");
      expect(columns).toContain("email");
    });
  });
});
