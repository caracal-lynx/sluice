/**
 * Merge strategy integration tests.
 *
 * Tests all four merge strategies (coalesce, priority-override, union, intersect)
 * end-to-end with realistic multi-source scenarios.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MultiSourcePipelineRunner } from '../../src/index.js';

function yamlPath(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('Merge strategy integration tests', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sluice-merge-'));
  });

  afterEach(() => {
    try {
      // Try to remove recursively; ignore permission errors from locked DuckDB files
      rmSync(workDir, { recursive: true, force: true });
    } catch (err) {
      // On Windows, DuckDB might still hold file locks; log and continue
      if ((err as any).code !== 'EPERM') throw err;
    }
  });

  describe('coalesce strategy', () => {
    it('merges two sources using coalesce: first non-null wins', async () => {
      const sqlServerCsv = join(workDir, 'sqlserver.csv');
      const excelCsv = join(workDir, 'excel.csv');
      const outputCsv = join(workDir, 'merged.csv');
      const pipelineYaml = join(workDir, 'coalesce-merge.pipeline.yaml');

      // SQL Server source: primary data with some gaps
      writeFileSync(
        sqlServerCsv,
        `CUSTOMER_ID,NAME,EMAIL,PHONE
1,Acme Corp,acme@example.com,555-1000
2,Beta Ltd,,555-2000
3,Gamma Inc,gamma@example.com,`,
      );

      // Excel source: enrichment data
      writeFileSync(
        excelCsv,
        `CUSTOMER_ID,NAME,EMAIL,PHONE
1,Acme,acme.biz@example.com,555-1001
2,Beta Limited,beta@example.com,555-2001
4,Delta Corp,delta@example.com,555-4000`,
      );

      // Create pipeline with coalesce merge
      writeFileSync(
        pipelineYaml,
        `
pipeline:
  name: coalesce-merge
  client: test
  version: "1.0"
  entity: Customer
  description: Coalesce merge test

sources:
  - id: sql-server
    priority: 1
    adapter: csv
    file: ${yamlPath(sqlServerCsv)}
    delimiter: ","
  - id: excel
    priority: 2
    adapter: csv
    file: ${yamlPath(excelCsv)}
    delimiter: ","

merge:
  strategy: coalesce
  key: CUSTOMER_ID
  onUnmatched: include

dq:
  stopOnCritical: false
  rules: []

transform:
  fields:
    - { from: CUSTOMER_ID, to: CUSTOMER_ID, type: string }
    - { from: NAME, to: NAME, type: string }
    - { from: EMAIL, to: EMAIL, type: string }
    - { from: PHONE, to: PHONE, type: string }

target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true

run:
  mode: full
  dryRun: false
  outputDir: ${yamlPath(workDir)}
`,
      );

      const runner = new MultiSourcePipelineRunner();
      const result = await runner.run(pipelineYaml);

      expect(result.pipeline).toBe('coalesce-merge');
      expect(result.extract.rowsExtracted).toBeGreaterThan(0);
      expect(result.merge).toBeDefined();
      expect(result.merge?.rowsMerged).toBeGreaterThan(0);

      // Verify output contains coalesced values
      const output = readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('CUSTOMER_ID');
      expect(output).toContain('Acme Corp'); // SQL Server name (priority 1)
      expect(output).toContain('beta@example.com'); // Excel email (SQL was empty)
    });
  });

  describe('union strategy', () => {
    it('merges multiple sources including all rows', async () => {
      const source1Csv = join(workDir, 'source1.csv');
      const source2Csv = join(workDir, 'source2.csv');
      const outputCsv = join(workDir, 'merged.csv');
      const pipelineYaml = join(workDir, 'union-merge.pipeline.yaml');

      // Source 1: Regional data
      writeFileSync(
        source1Csv,
        `STYLE_ID,STYLE_DESC,DIVISION
S001,Summer Collection,WOMENS
S002,Spring Basics,ACCESSORIES`,
      );

      // Source 2: Different region
      writeFileSync(
        source2Csv,
        `STYLE_ID,STYLE_DESC,DIVISION
S001,Summer,WOMENS
S003,Winter Coats,MENS`,
      );

      // Create pipeline with union merge
      writeFileSync(
        pipelineYaml,
        `
pipeline:
  name: union-merge
  client: test
  version: "1.0"
  entity: Style
  description: Union merge test

sources:
  - id: region-a
    priority: 1
    adapter: csv
    file: ${yamlPath(source1Csv)}
  - id: region-b
    priority: 2
    adapter: csv
    file: ${yamlPath(source2Csv)}

merge:
  strategy: union
  key: STYLE_ID
  onUnmatched: include

dq:
  stopOnCritical: false
  rules: []

transform:
  fields:
    - { from: STYLE_ID, to: STYLE_ID, type: string }
    - { from: STYLE_DESC, to: STYLE_DESC, type: string }
    - { from: DIVISION, to: DIVISION, type: string }

target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true

run:
  mode: full
  dryRun: false
  outputDir: ${yamlPath(workDir)}
`,
      );

      const runner = new MultiSourcePipelineRunner();
      const result = await runner.run(pipelineYaml);

      expect(result.pipeline).toBe('union-merge');
      expect(result.merge).toBeDefined();
      // Union should include all rows: S001 (dedup), S002, S003
      expect(result.merge?.rowsMerged).toBe(3);

      const output = readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('S001');
      expect(output).toContain('S002');
      expect(output).toContain('S003');
    });
  });

  describe('intersect strategy', () => {
    it('merges only rows present in all sources', async () => {
      const source1Csv = join(workDir, 'source1.csv');
      const source2Csv = join(workDir, 'source2.csv');
      const outputCsv = join(workDir, 'merged.csv');
      const pipelineYaml = join(workDir, 'intersect-merge.pipeline.yaml');

      // Source 1: Legacy system
      writeFileSync(
        source1Csv,
        `CUST_NO,CUST_NAME
C001,Acme Corp
C002,Beta Ltd
C003,Gamma Inc`,
      );

      // Source 2: New system (only has C001 and C002)
      writeFileSync(
        source2Csv,
        `CUST_NO,CUST_NAME
C001,Acme
C002,Beta Limited`,
      );

      // Create pipeline with intersect merge
      writeFileSync(
        pipelineYaml,
        `
pipeline:
  name: intersect-merge
  client: test
  version: "1.0"
  entity: Customer
  description: Intersect merge test (validation scenario)

sources:
  - id: legacy
    priority: 1
    adapter: csv
    file: ${yamlPath(source1Csv)}
  - id: modern
    priority: 2
    adapter: csv
    file: ${yamlPath(source2Csv)}

merge:
  strategy: intersect
  key: CUST_NO
  onUnmatched: exclude

dq:
  stopOnCritical: false
  rules: []

transform:
  fields:
    - { from: CUST_NO, to: CUST_NO, type: string }
    - { from: CUST_NAME, to: CUST_NAME, type: string }

target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true

run:
  mode: full
  dryRun: false
  outputDir: ${yamlPath(workDir)}
`,
      );

      const runner = new MultiSourcePipelineRunner();
      const result = await runner.run(pipelineYaml);

      expect(result.pipeline).toBe('intersect-merge');
      expect(result.merge).toBeDefined();
      // Only C001 and C002 are in both sources
      expect(result.merge?.rowsMerged).toBe(2);

      const output = readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('C001');
      expect(output).toContain('C002');
      expect(output).not.toContain('C003'); // C003 only in source 1
    });
  });

  describe('priority-override strategy', () => {
    it('uses highest priority source values (including nulls)', async () => {
      const primaryCsv = join(workDir, 'primary.csv');
      const secondaryCsv = join(workDir, 'secondary.csv');
      const outputCsv = join(workDir, 'merged.csv');
      const pipelineYaml = join(workDir, 'priority-override-merge.pipeline.yaml');

      // Primary source: has authority
      writeFileSync(
        primaryCsv,
        `ITEM_ID,ITEM_NAME,PRICE
I001,Widget A,
I002,Widget B,9.99`,
      );

      // Secondary source: fallback
      writeFileSync(
        secondaryCsv,
        `ITEM_ID,ITEM_NAME,PRICE
I001,Widget Alpha,10.00
I002,Widget Beta,12.50`,
      );

      // Create pipeline with priority-override merge
      writeFileSync(
        pipelineYaml,
        `
pipeline:
  name: priority-override-merge
  client: test
  version: "1.0"
  entity: Item
  description: Priority-override merge test

sources:
  - id: primary
    priority: 1
    adapter: csv
    file: ${yamlPath(primaryCsv)}
  - id: secondary
    priority: 2
    adapter: csv
    file: ${yamlPath(secondaryCsv)}

merge:
  strategy: priority-override
  key: ITEM_ID
  onUnmatched: include

dq:
  stopOnCritical: false
  rules: []

transform:
  fields:
    - { from: ITEM_ID, to: ITEM_ID, type: string }
    - { from: ITEM_NAME, to: ITEM_NAME, type: string }
    - { from: PRICE, to: PRICE, type: string }

target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true

run:
  mode: full
  dryRun: false
  outputDir: ${yamlPath(workDir)}
`,
      );

      const runner = new MultiSourcePipelineRunner();
      const result = await runner.run(pipelineYaml);

      expect(result.pipeline).toBe('priority-override-merge');
      expect(result.merge).toBeDefined();
      expect(result.merge?.rowsMerged).toBeGreaterThan(0);

      const output = readFileSync(outputCsv, 'utf-8');
      expect(output).toContain('Widget A'); // Primary name
      expect(output).toContain('Widget B'); // Primary name
      // Price for I001 should be empty (primary is null, priority-override respects that)
    });
  });

  describe('merge with composite keys', () => {
    it('merges sources with composite primary keys', async () => {
      const source1Csv = join(workDir, 'source1.csv');
      const source2Csv = join(workDir, 'source2.csv');
      const outputCsv = join(workDir, 'merged.csv');
      const pipelineYaml = join(workDir, 'composite-key-merge.pipeline.yaml');

      // Source 1: By Season
      writeFileSync(
        source1Csv,
        `SEASON,STYLE_ID,STYLE_DESC
SS24,S001,Summer Basic
SS24,S002,Summer Dress
AW24,S003,Winter Coat`,
      );

      // Source 2: Warehouse data
      writeFileSync(
        source2Csv,
        `SEASON,STYLE_ID,QTY_ON_HAND
SS24,S001,150
SS24,S002,0
AW24,S004,50`,
      );

      // Create pipeline with composite key merge
      writeFileSync(
        pipelineYaml,
        `
pipeline:
  name: composite-merge
  client: test
  version: "1.0"
  entity: StyleInventory
  description: Composite key merge test

sources:
  - id: catalog
    priority: 1
    adapter: csv
    file: ${yamlPath(source1Csv)}
  - id: warehouse
    priority: 2
    adapter: csv
    file: ${yamlPath(source2Csv)}

merge:
  strategy: coalesce
  key: [SEASON, STYLE_ID]
  onUnmatched: include

dq:
  stopOnCritical: false
  rules: []

transform:
  fields:
    - { from: SEASON, to: SEASON, type: string }
    - { from: STYLE_ID, to: STYLE_ID, type: string }
    - { from: STYLE_DESC, to: STYLE_DESC, type: string }
    - { from: QTY_ON_HAND, to: QTY_ON_HAND, type: string }

target:
  adapter: csv
  output: ${yamlPath(outputCsv)}
  includeHeader: true

run:
  mode: full
  dryRun: false
  outputDir: ${yamlPath(workDir)}
`,
      );

      const runner = new MultiSourcePipelineRunner();
      const result = await runner.run(pipelineYaml);

      expect(result.pipeline).toBe('composite-merge');
      expect(result.merge).toBeDefined();
      expect(result.merge?.rowsMerged).toBeGreaterThan(0);

      const output = readFileSync(outputCsv, 'utf-8');
      // Should have rows for all unique (SEASON, STYLE_ID) combinations
      expect(output).toContain('SS24');
      expect(output).toContain('AW24');
    });
  });
});
