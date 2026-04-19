import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CsvSourceAdapter } from '../../../../src/adapters/source/csv.js';
import { SourceAdapterRegistry } from '../../../../src/adapters/source/index.js';
import type { RunConfig, SourceConfig } from '../../../../src/config/types.js';
import { StagingStore } from '../../../../src/staging/index.js';
import { ConfigError, SourceError } from '../../../../src/utils/errors.js';

const BASE_RUN: RunConfig = {
  mode: 'full',
  batchSize: 500,
  onError: 'continue',
  logLevel: 'info',
  dryRun: false,
  outputDir: './output',
  stagingDb: '',
};

describe('CsvSourceAdapter', () => {
  let store: StagingStore;
  let tmpDir: string;
  let adapter: CsvSourceAdapter;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    tmpDir = mkdtempSync(join(tmpdir(), 'sluice-csv-src-'));
    adapter = new CsvSourceAdapter();
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeCsv(name: string, content: string): string {
    const p = join(tmpDir, name);
    writeFileSync(p, content, 'utf8');
    return p;
  }

  it('extracts rows into stg_raw with VARCHAR columns', async () => {
    const file = writeCsv('simple.csv', 'id,name\n1,Alice\n2,Bob\n');
    const config: SourceConfig = { adapter: 'csv', file, delimiter: ',', encoding: 'utf-8' };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});

    expect(result.rowsExtracted).toBe(2);
    expect(result.tableName).toBe('stg_raw');
    expect(result.columns).toEqual([
      { name: 'id', duckDbType: 'VARCHAR' },
      { name: 'name', duckDbType: 'VARCHAR' },
    ]);
    expect(await store.rowCount('stg_raw')).toBe(2);
    expect(await store.columnNames('stg_raw')).toEqual(['id', 'name']);
  });

  it('strips the UTF-8 BOM from the first column header', async () => {
    const file = writeCsv('bom.csv', '\uFEFFid,name\n1,a\n');
    const config: SourceConfig = { adapter: 'csv', file, delimiter: ',', encoding: 'utf-8' };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.columns[0]!.name).toBe('id');
    expect(await store.columnNames('stg_raw')).toEqual(['id', 'name']);
  });

  it('concatenates glob-matched files into one staging table', async () => {
    writeCsv('data-a.csv', 'id,name\n1,a\n2,b\n');
    writeCsv('data-b.csv', 'id,name\n3,c\n');
    const config: SourceConfig = {
      adapter: 'csv',
      file: join(tmpDir, 'data-*.csv'),
      delimiter: ',',
      encoding: 'utf-8',
    };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(3);
    expect(await store.rowCount('stg_raw')).toBe(3);
  });

  it('honours a custom targetTable (Phase 3 prep Change 1)', async () => {
    const file = writeCsv('simple.csv', 'id,name\n1,a\n');
    const config: SourceConfig = { adapter: 'csv', file, delimiter: ',', encoding: 'utf-8' };
    const result = await adapter.extract(
      config,
      store,
      BASE_RUN,
      () => {},
      'stg_raw_sql_server',
    );
    expect(result.tableName).toBe('stg_raw_sql_server');
    expect(await store.tableExists('stg_raw_sql_server')).toBe(true);
    expect(await store.tableExists('stg_raw')).toBe(false);
    expect(await store.rowCount('stg_raw_sql_server')).toBe(1);
  });

  it('emits onProgress after each batch flush', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => `${i},name${i}`).join('\n');
    const file = writeCsv('big.csv', `id,name\n${rows}\n`);
    const config: SourceConfig = { adapter: 'csv', file, delimiter: ',', encoding: 'utf-8' };
    const progress: number[] = [];
    await adapter.extract(config, store, { ...BASE_RUN, batchSize: 10 }, (n) =>
      progress.push(n),
    );
    expect(progress).toEqual([10, 20, 25]);
  });

  it('throws SourceError when `file` is not set', async () => {
    const config = { adapter: 'csv', delimiter: ',', encoding: 'utf-8' } as SourceConfig;
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it('throws SourceError when a glob matches no files', async () => {
    const config: SourceConfig = {
      adapter: 'csv',
      file: join(tmpDir, 'nope-*.csv'),
      delimiter: ',',
      encoding: 'utf-8',
    };
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it('respects a non-default delimiter', async () => {
    const file = writeCsv('pipe.csv', 'id|name\n1|a\n2|b\n');
    const config: SourceConfig = { adapter: 'csv', file, delimiter: '|', encoding: 'utf-8' };
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(2);
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'name']);
  });
});

describe('SourceAdapterRegistry', () => {
  it('has the csv adapter registered via the barrel import', () => {
    expect(SourceAdapterRegistry.has('csv')).toBe(true);
    expect(SourceAdapterRegistry.list()).toContain('csv');
    expect(SourceAdapterRegistry.get('csv').id).toBe('csv');
  });

  it('throws ConfigError for unknown adapter ids', () => {
    expect(() => SourceAdapterRegistry.get('not-a-real-adapter')).toThrow(ConfigError);
  });

  it('throws ConfigError on duplicate registration', () => {
    expect(() =>
      SourceAdapterRegistry.register({
        id: 'csv',
        connect: async () => {},
        disconnect: async () => {},
        extract: async () => ({ rowsExtracted: 0, tableName: 'stg_raw', columns: [] }),
      }),
    ).toThrow(ConfigError);
  });
});
