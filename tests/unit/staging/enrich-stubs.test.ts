/**
 * Phase 4a — `StagingStore` stub tests.
 *
 * The three methods (`selectDistinct`, `addColumnIfNotExists`,
 * `batchUpdateColumns`) ship as throwing stubs in the open-source core. The
 * private `@caracal-lynx/sluice-enrich` package overwrites them on the
 * prototype at import time. These tests confirm the throwing-stub behaviour
 * is what actually ships.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StagingStore } from '../../../src/staging/index.js';
import { StagingError } from '../../../src/utils/errors.js';

describe('StagingStore — Phase 4a enrich stubs', () => {
  let store: StagingStore;

  beforeEach(async () => {
    store = new StagingStore(':memory:');
    await store.open();
  });

  afterEach(async () => {
    await store.close();
  });

  it('selectDistinct throws StagingError pointing at sluice-enrich', async () => {
    await expect(store.selectDistinct('VAT_NUMBER')).rejects.toMatchObject({
      name: 'StagingError',
      message: expect.stringContaining(
        'install @caracal-lynx/sluice-enrich',
      ) as unknown as string,
    });
    await expect(store.selectDistinct('VAT_NUMBER')).rejects.toBeInstanceOf(StagingError);
  });

  it('addColumnIfNotExists throws StagingError pointing at sluice-enrich', async () => {
    await expect(
      store.addColumnIfNotExists('vat_valid', 'BOOLEAN'),
    ).rejects.toMatchObject({
      name: 'StagingError',
      message: expect.stringContaining(
        'install @caracal-lynx/sluice-enrich',
      ) as unknown as string,
    });
  });

  it('batchUpdateColumns throws StagingError pointing at sluice-enrich', async () => {
    const updates = new Map<number, Record<string, unknown>>([
      [0, { vat_valid: true, vat_name: 'ACME' }],
    ]);
    await expect(store.batchUpdateColumns(updates)).rejects.toMatchObject({
      name: 'StagingError',
      message: expect.stringContaining(
        'install @caracal-lynx/sluice-enrich',
      ) as unknown as string,
    });
  });
});
