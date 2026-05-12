/**
 * Phase 12 — multi-source prep phase end-to-end.
 *
 * Verifies that:
 *   - prep.rules with a sourceId fire per-source pre-merge, after rename;
 *   - prep.rules without a sourceId fire once post-merge against stg_merged;
 *   - both firings show up in the prep summary JSON;
 *   - --no-prep skips both firings.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MultiSourcePipelineRunner } from '../../src/multi-source-runner.js';

function yamlPath(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('Phase 12 — multi-source prep', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sluice-prep-ms-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('pre-merge firings run per source; post-merge firing runs once', async () => {
    // Source A: 8-char HC codes that need padding (pre-merge sourceId rule).
    // Source B: HC codes already correct but mis-cased style numbers (pre-merge sourceId rule).
    // Post-merge: uppercase a free-text field shared across both.
    const sourceA = join(workDir, 'a.csv');
    const sourceB = join(workDir, 'b.csv');
    writeFileSync(sourceA, 'STYLE_NO,HC_CODE,DESCR\nABC,61099090,some text\n', 'utf8');
    writeFileSync(sourceB, 'STYLE_NO,HC_CODE,DESCR\nabc,6109909000,other text\n', 'utf8');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline: { name: ms-prep, client: t, version: "1.0", entity: T }
sources:
  - id: a
    priority: 1
    adapter: csv
    file: ${yamlPath(sourceA)}
  - id: b
    priority: 2
    adapter: csv
    file: ${yamlPath(sourceB)}
merge:
  key: STYLE_NO
  strategy: coalesce
prep:
  rules:
    # Pre-merge per source
    - field: HC_CODE
      sourceId: a
      cleanse: padEnd:10:0
    - field: STYLE_NO
      sourceId: b
      cleanse: uppercase
    # Post-merge (no sourceId) — applies to stg_merged
    - field: DESCR
      cleanse: uppercase
dq: { rules: [] }
transform:
  fields:
    - { from: STYLE_NO, to: StyleNo, type: string }
    - { from: HC_CODE, to: HsCode, type: string }
    - { from: DESCR, to: Descr, type: string }
target:
  adapter: csv
  output: ${yamlPath(join(workDir, 'output.csv'))}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      'utf8',
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);

    // Three firings: source a, source b, post-merge.
    expect(result.prepSummary).toBeDefined();
    expect(result.prepSummary!.firings).toHaveLength(3);

    const firingA = result.prepSummary!.firings.find((f) => f.sourceId === 'a');
    const firingB = result.prepSummary!.firings.find((f) => f.sourceId === 'b');
    const firingMerged = result.prepSummary!.firings.find((f) => f.sourceId === null);
    expect(firingA).toBeDefined();
    expect(firingB).toBeDefined();
    expect(firingMerged).toBeDefined();

    expect(firingA!.table).toBe('stg_raw_a');
    expect(firingA!.rules[0]!.op).toBe('cleanse:padEnd:10:0');
    expect(firingA!.rules[0]!.rowsChanged).toBe(1);

    expect(firingB!.table).toBe('stg_raw_b');
    expect(firingB!.rules[0]!.op).toBe('cleanse:uppercase');
    expect(firingB!.rules[0]!.rowsChanged).toBe(1);

    expect(firingMerged!.table).toBe('stg_merged');
    expect(firingMerged!.rules[0]!.op).toBe('cleanse:uppercase');

    // End-to-end: output reflects every prep mutation.
    // Both sources should merge on STYLE_NO. Source A's STYLE_NO is "ABC";
    // source B's was "abc" but prep uppercased it to "ABC", so they merge.
    const out = readFileSync(join(workDir, 'output.csv'), 'utf8');
    expect(out).toContain('ABC');
    expect(out).toContain('6109909000');
    // Both rows' DESCR were uppercased post-merge.
    expect(out).toMatch(/SOME TEXT|OTHER TEXT/);
  });

  it('pre-merge prep runs after rename — rules reference renamed columns', async () => {
    const sourceA = join(workDir, 'a.csv');
    // Original column header is "Hs Code" (with space). Rename to HC_CODE.
    // The prep rule references the renamed column name "HC_CODE", not the original.
    writeFileSync(sourceA, 'STYLE_NO,Hs Code\nABC,61099090\n', 'utf8');
    const sourceB = join(workDir, 'b.csv');
    writeFileSync(sourceB, 'STYLE_NO,HC_CODE\nXYZ,6204620000\n', 'utf8');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline: { name: ms-rename-prep, client: t, version: "1.0", entity: T }
sources:
  - id: a
    priority: 1
    adapter: csv
    file: ${yamlPath(sourceA)}
    rename:
      "Hs Code": HC_CODE
  - id: b
    priority: 2
    adapter: csv
    file: ${yamlPath(sourceB)}
merge: { key: STYLE_NO }
prep:
  rules:
    - field: HC_CODE
      sourceId: a
      cleanse: padEnd:10:0
dq: { rules: [] }
transform:
  fields:
    - { from: STYLE_NO, to: StyleNo, type: string }
    - { from: HC_CODE, to: HsCode, type: string }
target:
  adapter: csv
  output: ${yamlPath(join(workDir, 'output.csv'))}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      'utf8',
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);
    expect(result.prepSummary).toBeDefined();
    const firingA = result.prepSummary!.firings.find((f) => f.sourceId === 'a');
    expect(firingA).toBeDefined();
    expect(firingA!.rules[0]!.rowsChanged).toBe(1);

    const out = readFileSync(join(workDir, 'output.csv'), 'utf8');
    expect(out).toContain('6109909000');
  });

  it('--no-prep skips both pre-merge and post-merge firings', async () => {
    const sourceA = join(workDir, 'a.csv');
    const sourceB = join(workDir, 'b.csv');
    writeFileSync(sourceA, 'id,val\n1,foo\n', 'utf8');
    writeFileSync(sourceB, 'id,val\n2,bar\n', 'utf8');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline: { name: ms-no-prep, client: t, version: "1.0", entity: T }
sources:
  - { id: a, priority: 1, adapter: csv, file: ${yamlPath(sourceA)} }
  - { id: b, priority: 2, adapter: csv, file: ${yamlPath(sourceB)} }
merge: { key: id }
prep:
  rules:
    - { field: val, sourceId: a, cleanse: uppercase }
    - { field: val, cleanse: lowercase }
dq: { rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
    - { from: val, to: val, type: string }
target:
  adapter: csv
  output: ${yamlPath(join(workDir, 'output.csv'))}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      'utf8',
    );

    const result = await new MultiSourcePipelineRunner().run(yaml, { skipPrep: true });
    expect(result.prepSummary).toBeUndefined();
    expect(existsSync(join(workDir, 'ms-no-prep-prep-summary.json'))).toBe(false);

    const out = readFileSync(join(workDir, 'output.csv'), 'utf8');
    // Without prep, values are unchanged.
    expect(out).toContain('foo');
    expect(out).toContain('bar');
  });

  it('only pre-merge firings — no post-merge rules → 2 firings, no stg_merged firing', async () => {
    const sourceA = join(workDir, 'a.csv');
    const sourceB = join(workDir, 'b.csv');
    writeFileSync(sourceA, 'id,val\n1,Foo\n', 'utf8');
    writeFileSync(sourceB, 'id,val\n2,Bar\n', 'utf8');

    const yaml = join(workDir, 'pipeline.yaml');
    writeFileSync(
      yaml,
      `
pipeline: { name: ms-pre-only, client: t, version: "1.0", entity: T }
sources:
  - { id: a, priority: 1, adapter: csv, file: ${yamlPath(sourceA)} }
  - { id: b, priority: 2, adapter: csv, file: ${yamlPath(sourceB)} }
merge: { key: id }
prep:
  rules:
    - { field: val, sourceId: a, cleanse: uppercase }
    - { field: val, sourceId: b, cleanse: lowercase }
dq: { rules: [] }
transform:
  fields:
    - { from: id, to: id, type: string }
    - { from: val, to: val, type: string }
target:
  adapter: csv
  output: ${yamlPath(join(workDir, 'output.csv'))}
  includeHeader: true
run:
  stagingDb: ":memory:"
  outputDir: ${yamlPath(workDir)}
`,
      'utf8',
    );

    const result = await new MultiSourcePipelineRunner().run(yaml);
    expect(result.prepSummary).toBeDefined();
    expect(result.prepSummary!.firings).toHaveLength(2);
    expect(result.prepSummary!.firings.every((f) => f.sourceId !== null)).toBe(true);
  });
});
