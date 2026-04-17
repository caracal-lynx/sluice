import { describe, it, expect } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { PipelineSchema, CompositeRuleSchema } from '../../../src/config/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../fixtures');

function loadFixture(filename: string): unknown {
  const content = readFileSync(path.join(fixturesDir, filename), 'utf-8');
  return yamlLoad(content);
}

// Minimal valid pipeline object (all optional fields omitted, run section omitted entirely)
const minimal = {
  pipeline: {
    name: 'minimal-test',
    client: 'test-client',
    version: '1.0',
    entity: 'TestEntity',
  },
  source: {
    adapter: 'csv',
    file: './data/test.csv',
  },
  dq: {
    rules: [],
  },
  transform: {
    fields: [{ from: 'id', to: 'Id', type: 'string' }],
  },
  target: {
    adapter: 'csv',
  },
};

describe('PipelineSchema', () => {
  describe('fixture pipelines', () => {
    it('parses acme-corp-customers.pipeline.yaml cleanly', () => {
      const raw = loadFixture('acme-corp-customers.pipeline.yaml');
      const result = PipelineSchema.parse(raw);
      expect(result.pipeline.name).toBe('acme-corp-customers');
      expect(result.pipeline.entity).toBe('CustomerInfo');
      expect(result.source.adapter).toBe('mssql');
      expect(result.target.adapter).toBe('ifs');
    });

    it('parses style-co-styles.pipeline.yaml cleanly', () => {
      const raw = loadFixture('style-co-styles.pipeline.yaml');
      const result = PipelineSchema.parse(raw);
      expect(result.pipeline.name).toBe('style-co-styles');
      expect(result.pipeline.entity).toBe('Style');
      expect(result.source.adapter).toBe('csv');
      expect(result.target.adapter).toBe('bluecherry');
    });
  });

  describe('minimal pipeline with defaults', () => {
    it('parses with run section omitted and applies defaults', () => {
      const result = PipelineSchema.parse(minimal);
      expect(result.run.mode).toBe('full');
      expect(result.run.batchSize).toBe(500);
      expect(result.run.dryRun).toBe(false);
      expect(result.run.logLevel).toBe('info');
      expect(result.run.outputDir).toBe('./output');
    });

    it('applies source defaults', () => {
      const result = PipelineSchema.parse(minimal);
      expect(result.source.delimiter).toBe(',');
      expect(result.source.encoding).toBe('utf-8');
    });

    it('applies target defaults', () => {
      const result = PipelineSchema.parse(minimal);
      expect(result.target.delimiter).toBe(',');
      expect(result.target.encoding).toBe('utf-8');
      expect(result.target.nullValue).toBe('');
      expect(result.target.onConflict).toBe('fail');
      expect(result.target.apiVersion).toBe('v2.0');
    });

    it('applies dq defaults', () => {
      const result = PipelineSchema.parse(minimal);
      expect(result.dq.stopOnCritical).toBe(true);
      expect(result.dq.rules).toEqual([]);
    });
  });

  describe('validation errors', () => {
    it('throws ZodError for invalid pipeline name (uppercase)', () => {
      const raw = { ...minimal, pipeline: { ...minimal.pipeline, name: 'Invalid_Name' } };
      expect(() => PipelineSchema.parse(raw)).toThrow(ZodError);
    });

    it('throws ZodError for source with no query, file, or endpoint', () => {
      const raw = {
        ...minimal,
        source: { adapter: 'mssql', connection: 'mssql://server/db' },
      };
      expect(() => PipelineSchema.parse(raw)).toThrow(ZodError);
    });

    it('throws ZodError for type: custom without customOp', () => {
      const raw = {
        ...minimal,
        transform: {
          fields: [{ to: 'Foo', type: 'custom' }],
        },
      };
      expect(() => PipelineSchema.parse(raw)).toThrow(ZodError);
    });

    it('throws ZodError for unknown source adapter', () => {
      const raw = { ...minimal, source: { adapter: 'oracle', file: './data/test.csv' } };
      expect(() => PipelineSchema.parse(raw)).toThrow(ZodError);
    });

    it('throws ZodError for transform with no fields', () => {
      const raw = { ...minimal, transform: { fields: [] } };
      expect(() => PipelineSchema.parse(raw)).toThrow(ZodError);
    });
  });

  describe('TargetSchema.onConflict / upsertKey', () => {
    it('throws ZodError when onConflict is "upsert" but upsertKey is missing', () => {
      const raw = {
        ...minimal,
        target: { adapter: 'pg', table: 'customers', onConflict: 'upsert' },
      };
      expect(() => PipelineSchema.parse(raw)).toThrow(ZodError);
    });

    it('throws ZodError when onConflict is "upsert" and upsertKey is empty', () => {
      const raw = {
        ...minimal,
        target: { adapter: 'pg', table: 'customers', onConflict: 'upsert', upsertKey: [] },
      };
      expect(() => PipelineSchema.parse(raw)).toThrow(ZodError);
    });

    it('passes when onConflict is "upsert" and upsertKey is set', () => {
      const raw = {
        ...minimal,
        target: {
          adapter: 'pg',
          table: 'customers',
          onConflict: 'upsert',
          upsertKey: ['customer_no'],
        },
      };
      expect(() => PipelineSchema.parse(raw)).not.toThrow();
    });

    it('passes when onConflict is "fail" without upsertKey', () => {
      const raw = {
        ...minimal,
        target: { adapter: 'pg', table: 'customers', onConflict: 'fail' },
      };
      expect(() => PipelineSchema.parse(raw)).not.toThrow();
    });
  });

  describe('FieldMappingSchema.from requirement', () => {
    const withFields = (fields: unknown[]) => ({ ...minimal, transform: { fields } });

    it('throws ZodError when type: string omits "from"', () => {
      expect(() => PipelineSchema.parse(withFields([{ to: 'Foo', type: 'string' }]))).toThrow(ZodError);
    });

    it('throws ZodError when type: lookup omits "from"', () => {
      expect(() =>
        PipelineSchema.parse(withFields([{ to: 'Foo', type: 'lookup', lookup: 'm' }])),
      ).toThrow(ZodError);
    });

    it('throws ZodError when type: concat omits "from"', () => {
      expect(() =>
        PipelineSchema.parse(withFields([{ to: 'Foo', type: 'concat', separator: ',' }])),
      ).toThrow(ZodError);
    });

    it('allows type: constant without "from"', () => {
      expect(() =>
        PipelineSchema.parse(withFields([{ to: 'Foo', type: 'constant', value: 'bar' }])),
      ).not.toThrow();
    });

    it('allows type: expression without "from"', () => {
      expect(() =>
        PipelineSchema.parse(withFields([{ to: 'Foo', type: 'expression', value: 'row.x' }])),
      ).not.toThrow();
    });

    it('allows type: custom without "from" (customOp set)', () => {
      expect(() =>
        PipelineSchema.parse(withFields([{ to: 'Foo', type: 'custom', customOp: 'myOp' }])),
      ).not.toThrow();
    });
  });
});

describe('CompositeRuleSchema', () => {
  it('accepts a valid composite rule', () => {
    const raw = {
      id: 'style-coStyleNo',
      checks: [{ type: 'pattern', value: '^[A-Z]{2}$', severity: 'critical' }],
    };
    expect(() => CompositeRuleSchema.parse(raw)).not.toThrow();
  });

  it('rejects an id that collides with a built-in check type', () => {
    const raw = {
      id: 'notNull',
      checks: [{ type: 'pattern', value: '.+', severity: 'critical' }],
    };
    expect(() => CompositeRuleSchema.parse(raw)).toThrow(ZodError);
  });

  it('rejects an id with invalid characters', () => {
    const raw = {
      id: '123-bad',
      checks: [{ type: 'notNull', severity: 'critical' }],
    };
    expect(() => CompositeRuleSchema.parse(raw)).toThrow(ZodError);
  });

  it('rejects a composite rule with no checks', () => {
    const raw = { id: 'myRule', checks: [] };
    expect(() => CompositeRuleSchema.parse(raw)).toThrow(ZodError);
  });
});
