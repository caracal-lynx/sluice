import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StagingStore } from '../../../src/staging/index.js';
import { StagingError } from '../../../src/utils/errors.js';

describe('StagingStore (:memory:)', () => {
  let store: StagingStore;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
  });

  afterEach(async () => {
    await store.close();
  });

  it('open is idempotent; close on a never-opened store is a no-op', async () => {
    // Re-opening is fine
    await store.open();
    // Closing twice is fine
    await store.close();
    await store.close();
  });

  it('throws StagingError when used before open()', async () => {
    const fresh = new StagingStore(':memory:');
    await expect(fresh.query('SELECT 1')).rejects.toBeInstanceOf(StagingError);
  });

  it('round-trips all declared DuckDB types', async () => {
    await store.createTable('t', [
      { name: 'v_str', duckDbType: 'VARCHAR' },
      { name: 'v_int', duckDbType: 'BIGINT' },
      { name: 'v_num', duckDbType: 'DOUBLE' },
      { name: 'v_bool', duckDbType: 'BOOLEAN' },
      { name: 'v_ts', duckDbType: 'TIMESTAMP' },
    ]);
    await store.insertBatch('t', [
      {
        v_str: 'hello',
        v_int: 42,
        v_num: 3.14,
        v_bool: true,
        v_ts: '2026-04-19 12:00:00',
      },
      {
        v_str: null,
        v_int: null,
        v_num: null,
        v_bool: null,
        v_ts: null,
      },
    ]);

    const rows = await store.query<{
      v_str: string | null;
      v_int: bigint | null;
      v_num: number | null;
      v_bool: boolean | null;
      v_ts: Date | null;
    }>('SELECT * FROM t ORDER BY v_str NULLS LAST');

    expect(rows).toHaveLength(2);
    expect(rows[0]!.v_str).toBe('hello');
    // DuckDB returns BIGINT as BigInt
    expect(rows[0]!.v_int).toBe(42n);
    expect(rows[0]!.v_num).toBeCloseTo(3.14);
    expect(rows[0]!.v_bool).toBe(true);
    expect(rows[0]!.v_ts).toBeInstanceOf(Date);
    expect(rows[1]!.v_str).toBeNull();
    expect(rows[1]!.v_int).toBeNull();
  });

  it('insertBatch with mixed nulls and missing keys fills as NULL', async () => {
    await store.createTable('mix', [
      { name: 'a', duckDbType: 'VARCHAR' },
      { name: 'b', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('mix', [
      { a: 'one', b: 'two' },
      // undefined entries coerced to null
      { a: 'three', b: undefined },
    ]);
    const rows = await store.query<{ a: string; b: string | null }>(
      'SELECT a, b FROM mix ORDER BY a',
    );
    expect(rows).toEqual([
      { a: 'one', b: 'two' },
      { a: 'three', b: null },
    ]);
  });

  it('insertBatch with empty input is a no-op', async () => {
    await store.createTable('empty', [{ name: 'x', duckDbType: 'VARCHAR' }]);
    await expect(store.insertBatch('empty', [])).resolves.not.toThrow();
    expect(await store.rowCount('empty')).toBe(0);
  });

  it('rowCount and columnNames reflect schema', async () => {
    await store.createTable('stg_raw', [
      { name: 'id', duckDbType: 'BIGINT' },
      { name: 'name', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('stg_raw', [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ]);
    expect(await store.rowCount('stg_raw')).toBe(3);
    expect(await store.columnNames('stg_raw')).toEqual(['id', 'name']);
  });

  it('tableExists detects created and dropped tables', async () => {
    expect(await store.tableExists('ghost')).toBe(false);
    await store.createTable('ghost', [{ name: 'x', duckDbType: 'VARCHAR' }]);
    expect(await store.tableExists('ghost')).toBe(true);
    await store.dropTable('ghost');
    expect(await store.tableExists('ghost')).toBe(false);
  });

  it('dropTable on missing table is a no-op (IF EXISTS)', async () => {
    await expect(store.dropTable('nonexistent')).resolves.not.toThrow();
  });

  it('handles identifiers with spaces and quotes safely', async () => {
    await store.createTable('weird table', [
      { name: 'Style Number', duckDbType: 'VARCHAR' },
      { name: 'quote"col', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('weird table', [{ 'Style Number': 'S1', 'quote"col': 'q' }]);
    expect(await store.rowCount('weird table')).toBe(1);
    expect(await store.columnNames('weird table')).toEqual(['Style Number', 'quote"col']);
  });

  it('createTable with zero columns throws', async () => {
    await expect(store.createTable('bad', [])).rejects.toThrow(/no columns/);
  });

  it('query propagates SQL errors as StagingError', async () => {
    await expect(store.query('SELECT * FROM does_not_exist')).rejects.toBeInstanceOf(StagingError);
  });
});

describe('StagingStore.exportToCsv', () => {
  let store: StagingStore;
  let tmpDir: string;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    tmpDir = mkdtempSync(join(tmpdir(), 'sluice-staging-'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes CSV with header by default', async () => {
    await store.createTable('out', [
      { name: 'col_a', duckDbType: 'VARCHAR' },
      { name: 'col_b', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('out', [
      { col_a: 'x', col_b: 'y' },
      { col_a: 'p', col_b: 'q' },
    ]);
    const outFile = join(tmpDir, 'out.csv');
    await store.exportToCsv('out', outFile);
    const contents = readFileSync(outFile, 'utf8');
    expect(contents).toContain('col_a,col_b');
    expect(contents).toContain('x,y');
    expect(contents).toContain('p,q');
  });

  it('suppresses header when header: false', async () => {
    await store.createTable('noh', [{ name: 'c', duckDbType: 'VARCHAR' }]);
    await store.insertBatch('noh', [{ c: 'alone' }]);
    const outFile = join(tmpDir, 'noh.csv');
    await store.exportToCsv('noh', outFile, { header: false });
    const contents = readFileSync(outFile, 'utf8');
    expect(contents).not.toContain('c');
    expect(contents.trim()).toBe('alone');
  });

  it('honours a custom delimiter', async () => {
    await store.createTable('pipe', [
      { name: 'a', duckDbType: 'VARCHAR' },
      { name: 'b', duckDbType: 'VARCHAR' },
    ]);
    await store.insertBatch('pipe', [{ a: 'one', b: 'two' }]);
    const outFile = join(tmpDir, 'pipe.csv');
    await store.exportToCsv('pipe', outFile, { delimiter: '|' });
    const contents = readFileSync(outFile, 'utf8');
    expect(contents).toContain('a|b');
    expect(contents).toContain('one|two');
  });
});

describe('StagingStore.renameColumns()', () => {
  let store: StagingStore;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
  });

  afterEach(async () => {
    await store.close();
  });

  it('renames the specified columns', async () => {
    await store.createTable('test_rename', [
      { name: 'old_name', duckDbType: 'VARCHAR' },
      { name: 'keep_me', duckDbType: 'BIGINT' },
    ]);
    await store.insertBatch('test_rename', [{ old_name: 'hello', keep_me: 1 }]);
    await store.renameColumns('test_rename', { old_name: 'new_name' });

    const cols = await store.columnNames('test_rename');
    expect(cols).toContain('new_name');
    expect(cols).not.toContain('old_name');
    expect(cols).toContain('keep_me');

    const rows = await store.query<{ new_name: string }>('SELECT new_name FROM test_rename');
    expect(rows[0]!.new_name).toBe('hello');
  });

  it('handles column names with spaces', async () => {
    await store.createTable('test_spaces', [{ name: 'Style Number', duckDbType: 'VARCHAR' }]);
    await store.renameColumns('test_spaces', { 'Style Number': 'STYLE_NO' });
    const cols = await store.columnNames('test_spaces');
    expect(cols).toContain('STYLE_NO');
    expect(cols).not.toContain('Style Number');
  });

  it('logs a warning and continues if a rename key is not in the table', async () => {
    await store.createTable('test_missing', [{ name: 'STYLE_NO', duckDbType: 'VARCHAR' }]);
    await expect(
      store.renameColumns('test_missing', { nonexistent: 'STYLE_NO' }),
    ).resolves.not.toThrow();
    // Table should still be intact
    expect(await store.columnNames('test_missing')).toEqual(['STYLE_NO']);
  });

  it('is a no-op when renames is empty', async () => {
    await store.createTable('test_noop', [{ name: 'col', duckDbType: 'VARCHAR' }]);
    await expect(store.renameColumns('test_noop', {})).resolves.not.toThrow();
    expect(await store.columnNames('test_noop')).toEqual(['col']);
  });
});

describe('schema helpers', () => {
  it('quoteIdent escapes embedded quotes', async () => {
    const { quoteIdent } = await import('../../../src/staging/schema.js');
    expect(quoteIdent('col')).toBe('"col"');
    expect(quoteIdent('quote"col')).toBe('"quote""col"');
  });

  it('buildCreateTableSql produces valid DDL', async () => {
    const { buildCreateTableSql } = await import('../../../src/staging/schema.js');
    const sql = buildCreateTableSql('t', [
      { name: 'a', duckDbType: 'VARCHAR' },
      { name: 'b', duckDbType: 'BIGINT' },
    ]);
    expect(sql).toBe('CREATE TABLE IF NOT EXISTS "t" ("a" VARCHAR, "b" BIGINT)');
  });
});
