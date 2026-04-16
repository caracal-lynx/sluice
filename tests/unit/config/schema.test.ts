import { describe, it, expect } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { PipelineSchema } from '../../../src/config/schema.js';

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
    it('parses cochran-customers.pipeline.yaml cleanly', () => {
      const raw = loadFixture('cochran-customers.pipeline.yaml');
      const result = PipelineSchema.parse(raw);
      expect(result.pipeline.name).toBe('cochran-customers');
      expect(result.pipeline.entity).toBe('CustomerInfo');
      expect(result.source.adapter).toBe('mssql');
      expect(result.target.adapter).toBe('ifs');
    });

    it('parses eribe-styles.pipeline.yaml cleanly', () => {
      const raw = loadFixture('eribe-styles.pipeline.yaml');
      const result = PipelineSchema.parse(raw);
      expect(result.pipeline.name).toBe('eribe-styles');
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
});
