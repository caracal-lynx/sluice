import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeRejectionCsv, writeSummaryJson } from '../../../src/dq/reporter.js';
import type { DQSummary } from '../../../src/dq/types.js';

describe('DQ reporter', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sluice-dq-rep-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes a rejection CSV with the spec-defined header', async () => {
    const file = join(tmp, 'rej.csv');
    await writeRejectionCsv(file, [
      {
        field: 'CUST_CODE',
        rowIndex: 3,
        value: null,
        rule: 'notNull',
        severity: 'critical',
        message: 'CUST_CODE must not be null or empty',
      },
      {
        field: 'EMAIL',
        rowIndex: 5,
        value: 'bad',
        rule: 'email',
        severity: 'warning',
        message: 'EMAIL is not a valid email address',
      },
    ]);
    const content = readFileSync(file, 'utf-8');
    expect(content.split('\n')[0]).toBe('row_index,field,value,rule,severity,message');
    expect(content).toContain('3,CUST_CODE,,notNull,critical,CUST_CODE must not be null or empty');
    expect(content).toContain('5,EMAIL,bad,email,warning,');
  });

  it('writes an empty rejection CSV (header only) when there are no violations', async () => {
    const file = join(tmp, 'empty.csv');
    await writeRejectionCsv(file, []);
    const content = readFileSync(file, 'utf-8');
    expect(content.trim()).toBe('row_index,field,value,rule,severity,message');
  });

  it('writes summary JSON matching the CLAUDE.md shape and strips internal fields', async () => {
    const file = join(tmp, 'summary.json');
    const summary: DQSummary = {
      pipeline: 'test',
      runAt: '2026-04-19T09:30:00Z',
      rowsChecked: 10,
      rowsPassed: 7,
      rowsRejected: 3,
      violations: { critical: 2, warning: 5, info: 0 },
      byField: { CUST_CODE: { critical: 2, warning: 0, info: 0 } },
      reportPath: file,
      rejectedRowIndices: [1, 4, 7],
    };
    await writeSummaryJson(file, summary);
    const json = JSON.parse(readFileSync(file, 'utf-8'));
    expect(json.pipeline).toBe('test');
    expect(json.violations).toEqual({ critical: 2, warning: 5, info: 0 });
    expect(json.byField).toEqual({ CUST_CODE: { critical: 2, warning: 0, info: 0 } });
    expect(json.reportPath).toBe(file);
    // Internal field must be stripped
    expect(json.rejectedRowIndices).toBeUndefined();
  });
});
