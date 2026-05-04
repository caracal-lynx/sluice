/**
 * End-to-end integration of a styles-shaped pipeline:
 * CSV source → DQ rules → transforms (lookup, date, decimal, cleanse) →
 * BlueCherry target (required columns, header, date auto-format).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PipelineRunner } from '../../src/runner.js';

function yp(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('style-co-styles pipeline (CSV → BlueCherry)', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sluice-style-co-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('runs extract → DQ → transform → BlueCherry CSV and writes a state file', async () => {
    const stylesCsv = join(workDir, 'styles.csv');
    writeFileSync(
      stylesCsv,
      [
        'STYLE_NO,STYLE_DESC,DIVISION,SEASON_CODE,COST_PRICE,RETAIL_PRICE,VENDOR_CODE',
        'S001,Aran Jumper,W,AW25,25.00,89.99,V1',
        'S002,Knitted Hat,W,AW25,5.00,19.99,V2',
      ].join('\n'),
      'utf-8',
    );

    const divLookup = join(workDir, 'divisions.csv');
    writeFileSync(divLookup, 'legacyCode,bcCode\nW,WOMENS\nM,MENS\n', 'utf-8');

    const vendorLookup = join(workDir, 'vendors.csv');
    writeFileSync(
      vendorLookup,
      'legacyVendorCode,bcVendorNo\nV1,VENDOR-001\nV2,VENDOR-002\n',
      'utf-8',
    );

    const output = join(workDir, 'style-co-styles.csv');
    const yaml = `
pipeline:
  name: style-co-mini
  client: style-co
  version: "1.0"
  entity: Style

source:
  adapter: csv
  file: ${yp(stylesCsv)}

dq:
  stopOnCritical: true
  rules:
    - field: STYLE_NO
      checks:
        - { type: notNull, severity: critical }
        - { type: unique,  severity: critical }
    - field: COST_PRICE
      checks:
        - { type: min, value: 0, severity: critical }

transform:
  lookups:
    - name: divisionMap
      source: { adapter: csv, file: ${yp(divLookup)} }
      key: legacyCode
      value: bcCode
    - name: vendorMap
      source: { adapter: csv, file: ${yp(vendorLookup)} }
      key: legacyVendorCode
      value: bcVendorNo
  fields:
    - { from: STYLE_NO,     to: StyleNo,     type: string,  max: 20, cleanse: trim|uppercase }
    - { from: STYLE_DESC,   to: StyleDesc,   type: string,  max: 255, cleanse: trim }
    - { from: DIVISION,     to: Division,    type: lookup,  lookup: divisionMap }
    - { from: SEASON_CODE,  to: Season,      type: string,  max: 10 }
    - { from: VENDOR_CODE,  to: VendorNo,    type: lookup,  lookup: vendorMap, optional: true }
    - { from: COST_PRICE,   to: CostPrice,   type: decimal, precision: 2 }
    - { from: RETAIL_PRICE, to: RetailPrice, type: decimal, precision: 2 }
    - { to: ActiveFlag,     type: constant,  value: "Y" }

target:
  adapter: bluecherry
  entity: Style
  output: ${yp(output)}
  includeHeader: true
  dateFormat: MM/DD/YYYY
  nullValue: ""

run:
  stagingDb: ":memory:"
  outputDir: ${yp(workDir)}
`;
    const yamlPath = join(workDir, 'pipeline.yaml');
    writeFileSync(yamlPath, yaml, 'utf-8');

    const result = await new PipelineRunner().run(yamlPath);
    expect(result.extract.rowsExtracted).toBe(2);
    expect(result.dq.violations.critical).toBe(0);
    expect(result.load?.rowsLoaded).toBe(2);

    // Output CSV has the BlueCherry required column order + ActiveFlag
    const csv = readFileSync(output, 'utf-8');
    const firstLine = csv.split(/\r?\n/)[0]!;
    expect(firstLine.split(',')).toEqual([
      'StyleNo',
      'StyleDesc',
      'Division',
      'Season',
      'CostPrice',
      'RetailPrice',
      'ActiveFlag',
      'VendorNo',
    ]);
    expect(csv).toContain('S001,Aran Jumper,WOMENS,AW25,25.00,89.99,Y,VENDOR-001');

    // State file written
    const statePath = join(workDir, 'style-co-mini-state.json');
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state).toMatchObject({
      pipeline: 'style-co-mini',
      lastMode: 'full',
      rowsExtracted: 2,
      rowsLoaded: 2,
      criticalViolations: 0,
    });
    expect(state.lastRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
