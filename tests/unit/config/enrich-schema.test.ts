/**
 * Phase 4a — Zod schema tests for the enrich block.
 *
 * Confirms:
 *  - EnrichSchema accepts the spec's annotated YAML examples
 *  - Required/optional rules from the spec are enforced
 *  - PipelineSchema treats `enrich:` as optional
 *  - RunSchema's three new enrich tuning fields default correctly
 */

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';

import { EnrichSchema, PipelineSchema, RunSchema } from '../../../src/config/schema.js';

// ── EnrichSchema ──────────────────────────────────────────────────────────────

describe('EnrichSchema', () => {
  it('parses a single-lookup enrich block with defaults applied', () => {
    const result = EnrichSchema.parse({
      lookups: [
        {
          field: 'VAT_NUMBER',
          provider: 'vies',
          writeColumns: { valid: 'vat_valid' },
        },
      ],
    });
    expect(result.cache).toBe(true);     // default
    expect(result.onError).toBe('flag'); // default
    expect(result.lookups).toHaveLength(1);
  });

  it('parses a multi-lookup enrich block with overrides', () => {
    const result = EnrichSchema.parse({
      cache: 'persist',
      onError: 'skip',
      lookups: [
        {
          field: 'VAT_NUMBER',
          provider: 'hmrc-vat',
          writeColumns: {
            valid: 'vat_valid',
            name: 'vat_name',
            consultation_ref: 'vat_consult_ref',
          },
          preValidate: '^GB[0-9]{9}$',
          cache: false,
          onError: 'flag',
          options: { bearerToken: 'tok' },
        },
        {
          field: 'HS_CODE',
          provider: 'uk-trade-tariff',
          writeColumns: { valid: 'hs_valid', description: 'hs_description' },
        },
      ],
    });
    expect(result.cache).toBe('persist');
    expect(result.onError).toBe('skip');
    expect(result.lookups[0]?.cache).toBe(false);
    expect(result.lookups[1]?.cache).toBeUndefined();
  });

  it('rejects writeColumns missing the required `valid` key', () => {
    expect(() =>
      EnrichSchema.parse({
        lookups: [
          {
            field: 'X',
            provider: 'p',
            writeColumns: { name: 'company_name' }, // no `valid`
          },
        ],
      }),
    ).toThrow(ZodError);
  });

  it('rejects an empty lookups array (.min(1))', () => {
    expect(() => EnrichSchema.parse({ lookups: [] })).toThrow(ZodError);
  });

  it('rejects `cache: "persist"` at the lookup level (only boolean allowed)', () => {
    expect(() =>
      EnrichSchema.parse({
        lookups: [
          {
            field: 'X',
            provider: 'p',
            writeColumns: { valid: 'x_valid' },
            cache: 'persist', // root-level only
          },
        ],
      }),
    ).toThrow(ZodError);
  });

  it('rejects an unknown onError enum value', () => {
    expect(() =>
      EnrichSchema.parse({
        onError: 'bonkers',
        lookups: [
          { field: 'X', provider: 'p', writeColumns: { valid: 'x_valid' } },
        ],
      }),
    ).toThrow(ZodError);
  });

  it('accepts arbitrary additional writeColumns keys via catchall', () => {
    const result = EnrichSchema.parse({
      lookups: [
        {
          field: 'X',
          provider: 'p',
          writeColumns: {
            valid: 'x_valid',
            address_line1: 'x_addr1',
            processing_date: 'x_checked_at',
          },
        },
      ],
    });
    expect(result.lookups[0]?.writeColumns).toMatchObject({
      valid: 'x_valid',
      address_line1: 'x_addr1',
      processing_date: 'x_checked_at',
    });
  });
});

// ── RunSchema additions ───────────────────────────────────────────────────────

describe('RunSchema enrich tuning defaults', () => {
  it('applies enrich-tuning defaults when fields are omitted', () => {
    const result = RunSchema.parse({});
    expect(result.enrichConcurrency).toBe(5);
    expect(result.enrichTimeoutMs).toBe(5000);
    expect(result.enrichMaxRetries).toBe(3);
  });

  it('honours operator overrides', () => {
    const result = RunSchema.parse({
      enrichConcurrency: 20,
      enrichTimeoutMs: 30_000,
      enrichMaxRetries: 0,
    });
    expect(result.enrichConcurrency).toBe(20);
    expect(result.enrichTimeoutMs).toBe(30_000);
    expect(result.enrichMaxRetries).toBe(0);
  });

  it('rejects enrichMaxRetries above 5', () => {
    expect(() => RunSchema.parse({ enrichMaxRetries: 6 })).toThrow(ZodError);
  });

  it('rejects non-positive enrichConcurrency', () => {
    expect(() => RunSchema.parse({ enrichConcurrency: 0 })).toThrow(ZodError);
  });
});

// ── PipelineSchema integration ────────────────────────────────────────────────

const minimalPipeline = {
  pipeline: {
    name: 'enrich-schema-test',
    client: 'test-client',
    version: '1.0',
    entity: 'TestEntity',
  },
  source: { adapter: 'csv', file: './data/test.csv' },
  dq: { rules: [] },
  transform: { fields: [{ from: 'id', to: 'Id', type: 'string' }] },
  target: { adapter: 'csv' },
};

describe('PipelineSchema with enrich block', () => {
  it('treats enrich as optional — missing block parses to undefined', () => {
    const parsed = PipelineSchema.parse(minimalPipeline);
    expect(parsed.enrich).toBeUndefined();
  });

  it('parses a pipeline with a valid enrich block', () => {
    const parsed = PipelineSchema.parse({
      ...minimalPipeline,
      enrich: {
        lookups: [
          { field: 'VAT', provider: 'vies', writeColumns: { valid: 'vat_valid' } },
        ],
      },
    });
    expect(parsed.enrich).toBeDefined();
    expect(parsed.enrich?.lookups).toHaveLength(1);
  });

  it('rejects a pipeline whose enrich block has invalid writeColumns', () => {
    expect(() =>
      PipelineSchema.parse({
        ...minimalPipeline,
        enrich: {
          lookups: [
            { field: 'VAT', provider: 'vies', writeColumns: { name: 'x' } }, // no valid
          ],
        },
      }),
    ).toThrow(ZodError);
  });
});
