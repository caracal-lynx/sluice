import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { utils as xlsxUtils, write as xlsxWrite } from 'xlsx';

import { XlsxSourceAdapter } from '../../../../src/adapters/source/xlsx.js';
import type { RunConfig, SourceConfig } from '../../../../src/config/types.js';
import { StagingStore } from '../../../../src/staging/index.js';

const BASE_RUN: RunConfig = {
  mode: 'full',
  batchSize: 500,
  onError: 'continue',
  logLevel: 'info',
  dryRun: false,
  outputDir: './output',
  stagingDb: '',
};

function writeXlsx(filePath: string, sheets: Record<string, unknown[]>): void {
  const wb = xlsxUtils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = xlsxUtils.json_to_sheet(rows);
    xlsxUtils.book_append_sheet(wb, ws, name);
  }
  const buf = xlsxWrite(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  writeFileSync(filePath, buf);
}

describe('XlsxSourceAdapter', () => {
  let store: StagingStore;
  let tmp: string;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    tmp = mkdtempSync(join(tmpdir(), 'sluice-xlsx-'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reads a single-sheet XLSX and stages rows as VARCHAR', async () => {
    const file = join(tmp, 'single.xlsx');
    writeXlsx(file, { Data: [{ id: '1', name: 'a' }, { id: '2', name: 'b' }] });
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = { adapter: 'xlsx', file, delimiter: ',', encoding: 'utf-8' };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(2);
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'name']);
    await adapter.disconnect();
  });

  it('warns when multiple sheets exist and sheet is unset', async () => {
    const file = join(tmp, 'multi.xlsx');
    writeXlsx(file, { Alpha: [{ x: '1' }], Beta: [{ x: '2' }] });
    const warnSpy = vi.spyOn(await import('../../../../src/utils/logger.js').then((m) => m.logger), 'warn');
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = { adapter: 'xlsx', file, delimiter: ',', encoding: 'utf-8' };
    await adapter.connect(config);
    await adapter.extract(config, store, BASE_RUN, () => {});
    expect(warnSpy).toHaveBeenCalled();
  });

  it('reads a named sheet when specified', async () => {
    const file = join(tmp, 'multi.xlsx');
    writeXlsx(file, { Alpha: [{ x: 'one' }], Beta: [{ x: 'two' }] });
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = { adapter: 'xlsx', file, sheet: 'Beta', delimiter: ',', encoding: 'utf-8' };
    await adapter.connect(config);
    await adapter.extract(config, store, BASE_RUN, () => {});
    const rows = await store.query<{ x: string }>('SELECT * FROM stg_raw');
    expect(rows[0]!.x).toBe('two');
  });

  it('honours a custom targetTable (Phase 3 prep Change 1)', async () => {
    const file = join(tmp, 'single.xlsx');
    writeXlsx(file, { Data: [{ a: 'x' }] });
    const adapter = new XlsxSourceAdapter();
    const config: SourceConfig = { adapter: 'xlsx', file, delimiter: ',', encoding: 'utf-8' };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {}, 'stg_raw_excel');
    expect(result.tableName).toBe('stg_raw_excel');
    expect(await store.tableExists('stg_raw_excel')).toBe(true);
  });
});
