import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock axios — axios-retry attaches to the client, so we mock the whole module
// before the adapter imports it.
vi.mock('axios', () => {
  const get = vi.fn();
  const instance = { get, defaults: { headers: {} }, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
  const create = vi.fn(() => instance);
  return {
    default: { create, __get: get, __instance: instance },
  };
});
vi.mock('axios-retry', () => ({
  default: vi.fn(),
  exponentialDelay: vi.fn(),
  isNetworkOrIdempotentRequestError: () => false,
}));

const axiosModule = (await import('axios')) as unknown as {
  default: { __get: ReturnType<typeof vi.fn> };
};
const { RestSourceAdapter } = await import('../../../../src/adapters/source/rest.js');
const { StagingStore } = await import('../../../../src/staging/index.js');
const { SourceError } = await import('../../../../src/utils/errors.js');

import type { RunConfig, SourceConfig } from '../../../../src/config/types.js';

const BASE_RUN: RunConfig = {
  mode: 'full',
  batchSize: 500,
  onError: 'continue',
  logLevel: 'info',
  dryRun: false,
  outputDir: './output',
  stagingDb: '',
};

describe('RestSourceAdapter', () => {
  let store: InstanceType<typeof StagingStore>;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
    axiosModule.default.__get.mockReset();
  });

  afterEach(async () => {
    await store.close();
  });

  it('extracts a single-page JSON array (no pagination)', async () => {
    axiosModule.default.__get.mockResolvedValueOnce({
      data: [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ],
    });
    const adapter = new RestSourceAdapter();
    const config: SourceConfig = {
      adapter: 'rest',
      endpoint: 'https://api.example.com/things',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(2);
    await adapter.disconnect();
  });

  it('flattens nested JSON with __ separator', async () => {
    axiosModule.default.__get.mockResolvedValueOnce({
      data: [{ id: 1, address: { line1: 'abc', postCode: 'SW1A 1AA' } }],
    });
    const adapter = new RestSourceAdapter();
    const config: SourceConfig = {
      adapter: 'rest',
      endpoint: 'https://api.example.com/x',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    await adapter.extract(config, store, BASE_RUN, () => {});
    const cols = await store.columnNames('stg_raw');
    expect(cols).toContain('address__line1');
    expect(cols).toContain('address__postCode');
  });

  it('offset pagination walks all pages until short chunk', async () => {
    axiosModule.default.__get
      .mockResolvedValueOnce({ data: { items: [{ id: 1 }, { id: 2 }], total: 3 } })
      .mockResolvedValueOnce({ data: { items: [{ id: 3 }], total: 3 } });
    const adapter = new RestSourceAdapter();
    const config: SourceConfig = {
      adapter: 'rest',
      endpoint: 'https://api.example.com/x',
      delimiter: ',',
      encoding: 'utf-8',
      pagination: {
        type: 'offset',
        pageSize: 2,
        pageParam: 'skip',
        totalField: 'total',
        dataField: 'items',
      },
    };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(3);
  });

  it('page pagination stops when chunk < pageSize', async () => {
    axiosModule.default.__get
      .mockResolvedValueOnce({ data: { items: [{ id: 1 }, { id: 2 }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 3 }] } });
    const adapter = new RestSourceAdapter();
    const config: SourceConfig = {
      adapter: 'rest',
      endpoint: 'https://api.example.com/x',
      delimiter: ',',
      encoding: 'utf-8',
      pagination: {
        type: 'page',
        pageSize: 2,
        pageParam: 'page',
        dataField: 'items',
      },
    };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(3);
  });

  it('cursor pagination terminates when cursor is null', async () => {
    axiosModule.default.__get
      .mockResolvedValueOnce({
        data: { items: [{ id: 1 }, { id: 2 }], nextCursor: 'abc' },
      })
      .mockResolvedValueOnce({
        data: { items: [{ id: 3 }], nextCursor: null },
      });
    const adapter = new RestSourceAdapter();
    const config: SourceConfig = {
      adapter: 'rest',
      endpoint: 'https://api.example.com/x',
      delimiter: ',',
      encoding: 'utf-8',
      pagination: {
        type: 'cursor',
        pageSize: 2,
        dataField: 'items',
        cursorField: 'nextCursor',
        cursorParam: 'cursor',
      },
    };
    await adapter.connect(config);
    const result = await adapter.extract(config, store, BASE_RUN, () => {});
    expect(result.rowsExtracted).toBe(3);
  });

  it('honours a custom targetTable (Phase 3 prep Change 1)', async () => {
    axiosModule.default.__get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    const adapter = new RestSourceAdapter();
    const config: SourceConfig = {
      adapter: 'rest',
      endpoint: 'https://api.example.com/x',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    const result = await adapter.extract(
      config,
      store,
      BASE_RUN,
      () => {},
      'stg_raw_rest',
    );
    expect(result.tableName).toBe('stg_raw_rest');
  });

  it('throws SourceError when axios fails', async () => {
    axiosModule.default.__get.mockRejectedValueOnce(new Error('network down'));
    const adapter = new RestSourceAdapter();
    const config: SourceConfig = {
      adapter: 'rest',
      endpoint: 'https://api.example.com/x',
      delimiter: ',',
      encoding: 'utf-8',
    };
    await adapter.connect(config);
    await expect(adapter.extract(config, store, BASE_RUN, () => {})).rejects.toBeInstanceOf(
      SourceError,
    );
  });
});
