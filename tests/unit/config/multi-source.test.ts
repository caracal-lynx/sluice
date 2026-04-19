import { describe, it, expect } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PipelineSchema,
  MergeSchema,
  MultiSourceEntrySchema,
  isSingleSource,
  isMultiSource,
} from '../../../src/config/schema.js';
import type { Pipeline } from '../../../src/config/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../fixtures');

function loadFixture(filename: string): unknown {
  const content = readFileSync(path.join(fixturesDir, filename), 'utf-8');
  return yamlLoad(content);
}

// ── Minimal multi-source pipeline base ───────────────────────────────────────

const minimalTransform = {
  fields: [
    { from: 'STYLE_NO', to: 'StyleNo', type: 'string' },
  ],
};

const minimalDq = { rules: [] };

const minimalTarget = {
  adapter: 'csv',
  output: './output/test.csv',
};

const minimalSources = [
  { id: 'primary', priority: 1, adapter: 'csv', file: './data/a.csv' },
  { id: 'secondary', priority: 2, adapter: 'csv', file: './data/b.csv' },
];

const minimalMerge = {
  key: 'ID',
  strategy: 'coalesce',
};

function makeMultiSource(overrides: Record<string, unknown> = {}): unknown {
  return {
    pipeline: {
      name: 'multi-test',
      client: 'test-client',
      version: '1.0',
      entity: 'TestEntity',
    },
    sources: minimalSources,
    merge: minimalMerge,
    dq: minimalDq,
    transform: minimalTransform,
    target: minimalTarget,
    ...overrides,
  };
}

function makeSingleSource(overrides: Record<string, unknown> = {}): unknown {
  return {
    pipeline: {
      name: 'single-test',
      client: 'test-client',
      version: '1.0',
      entity: 'TestEntity',
    },
    source: { adapter: 'csv', file: './data/test.csv' },
    dq: minimalDq,
    transform: minimalTransform,
    target: minimalTarget,
    ...overrides,
  };
}

// ── Fixture ───────────────────────────────────────────────────────────────────

describe('multi-source fixture', () => {
  it('parses the eribe-products-merged fixture cleanly', () => {
    const raw = loadFixture('eribe-products-merged.pipeline.yaml');
    // Substitute env vars that ConfigLoader would normally resolve
    const withEnv = JSON.parse(
      JSON.stringify(raw).replace(/\$\{[^}]+\}/g, 'placeholder'),
    );
    const result = PipelineSchema.safeParse(withEnv);
    if (!result.success) {
      // Surface the actual Zod errors for easier debugging
      throw new Error(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n'));
    }
    expect(result.success).toBe(true);
    const p = result.data;
    expect(p.pipeline.name).toBe('eribe-products-merged');
    expect(p.sources).toHaveLength(3);
    expect(p.merge?.key).toBe('STYLE_NO');
    expect(p.merge?.strategy).toBe('coalesce');
  });
});

// ── MergeSchema ───────────────────────────────────────────────────────────────

describe('MergeSchema', () => {
  it('accepts a minimal merge config', () => {
    expect(MergeSchema.safeParse({ key: 'ID', strategy: 'coalesce' }).success).toBe(true);
  });

  it('accepts a compound key array', () => {
    expect(MergeSchema.safeParse({ key: ['STYLE_NO', 'COLOUR_CODE'] }).success).toBe(true);
  });

  it('defaults strategy to coalesce', () => {
    const result = MergeSchema.parse({ key: 'ID' });
    expect(result.strategy).toBe('coalesce');
  });

  it('defaults onUnmatched to include', () => {
    const result = MergeSchema.parse({ key: 'ID' });
    expect(result.onUnmatched).toBe('include');
  });

  it('accepts all valid strategies', () => {
    for (const strategy of ['coalesce', 'priority-override', 'union', 'intersect'] as const) {
      expect(MergeSchema.safeParse({ key: 'ID', strategy }).success).toBe(true);
    }
  });

  it('rejects a fieldStrategy with neither strategy nor source', () => {
    const result = MergeSchema.safeParse({
      key: 'ID',
      fieldStrategies: [{ field: 'CostPrice' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a fieldStrategy with strategy only', () => {
    const result = MergeSchema.safeParse({
      key: 'ID',
      fieldStrategies: [{ field: 'CostPrice', strategy: 'priority-override' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a fieldStrategy with source only', () => {
    const result = MergeSchema.safeParse({
      key: 'ID',
      fieldStrategies: [{ field: 'FibreContent', source: 'excel' }],
    });
    expect(result.success).toBe(true);
  });
});

// ── MultiSourceEntrySchema ────────────────────────────────────────────────────

describe('MultiSourceEntrySchema', () => {
  it('accepts a valid csv source entry', () => {
    const result = MultiSourceEntrySchema.safeParse({
      id: 'primary',
      priority: 1,
      adapter: 'csv',
      file: './data/a.csv',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an id with uppercase letters', () => {
    const result = MultiSourceEntrySchema.safeParse({
      id: 'Primary',
      priority: 1,
      adapter: 'csv',
      file: './data/a.csv',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an id with underscores', () => {
    const result = MultiSourceEntrySchema.safeParse({
      id: 'sql_server',
      priority: 1,
      adapter: 'csv',
      file: './data/a.csv',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an id with hyphens', () => {
    const result = MultiSourceEntrySchema.safeParse({
      id: 'sql-server',
      priority: 1,
      adapter: 'csv',
      file: './data/a.csv',
    });
    expect(result.success).toBe(true);
  });

  it('rejects priority of 0 or negative', () => {
    expect(MultiSourceEntrySchema.safeParse({
      id: 'x', priority: 0, adapter: 'csv', file: './data/a.csv',
    }).success).toBe(false);
    expect(MultiSourceEntrySchema.safeParse({
      id: 'x', priority: -1, adapter: 'csv', file: './data/a.csv',
    }).success).toBe(false);
  });

  it('accepts a rename map with keys that contain spaces', () => {
    const result = MultiSourceEntrySchema.safeParse({
      id: 'excel',
      priority: 3,
      adapter: 'xlsx',
      file: './data/a.xlsx',
      rename: { 'Style Number': 'STYLE_NO', 'Description': 'STYLE_DESC' },
    });
    expect(result.success).toBe(true);
  });
});

// ── PipelineSchema — multi-source validation ──────────────────────────────────

describe('PipelineSchema multi-source', () => {
  it('accepts a valid minimal multi-source pipeline', () => {
    const result = PipelineSchema.safeParse(makeMultiSource());
    expect(result.success).toBe(true);
  });

  it('accepts a valid single-source pipeline unchanged', () => {
    const result = PipelineSchema.safeParse(makeSingleSource());
    expect(result.success).toBe(true);
  });

  it('rejects a pipeline with both source and sources present', () => {
    const result = PipelineSchema.safeParse(makeMultiSource({
      source: { adapter: 'csv', file: './data/test.csv' },
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message);
      expect(messages.some(m => m.includes('source') && m.includes('sources'))).toBe(true);
    }
  });

  it('rejects a pipeline with sources but no merge', () => {
    const result = PipelineSchema.safeParse(makeMultiSource({ merge: undefined }));
    expect(result.success).toBe(false);
  });

  it('rejects a pipeline with merge but no sources', () => {
    const result = PipelineSchema.safeParse({
      ...makeSingleSource(),
      merge: minimalMerge,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a pipeline with neither source nor sources', () => {
    const result = PipelineSchema.safeParse({
      pipeline: {
        name: 'no-source',
        client: 'test',
        version: '1.0',
        entity: 'Test',
      },
      dq: minimalDq,
      transform: minimalTransform,
      target: minimalTarget,
    });
    expect(result.success).toBe(false);
  });

  it('rejects sources array with fewer than 2 entries', () => {
    const result = PipelineSchema.safeParse(makeMultiSource({
      sources: [{ id: 'only-one', priority: 1, adapter: 'csv', file: './data/a.csv' }],
    }));
    expect(result.success).toBe(false);
  });

  it('rejects duplicate source ids in sources', () => {
    const result = PipelineSchema.safeParse(makeMultiSource({
      sources: [
        { id: 'dup', priority: 1, adapter: 'csv', file: './data/a.csv' },
        { id: 'dup', priority: 2, adapter: 'csv', file: './data/b.csv' },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message);
      expect(messages.some(m => m.toLowerCase().includes('duplicate'))).toBe(true);
    }
  });

  it('rejects incremental mode with multi-source when incrementalSource is missing', () => {
    const result = PipelineSchema.safeParse(makeMultiSource({
      merge: { key: 'ID', strategy: 'coalesce' },   // no incrementalSource
      run: { mode: 'incremental' },
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message);
      expect(messages.some(m => m.toLowerCase().includes('incrementalsource'))).toBe(true);
    }
  });

  it('accepts incremental mode with multi-source when incrementalSource is set', () => {
    const result = PipelineSchema.safeParse(makeMultiSource({
      merge: { key: 'ID', strategy: 'coalesce', incrementalSource: 'primary' },
      run: { mode: 'incremental' },
    }));
    expect(result.success).toBe(true);
  });

  it('rejects incrementalSource that does not match any source id', () => {
    const result = PipelineSchema.safeParse(makeMultiSource({
      merge: { key: 'ID', strategy: 'coalesce', incrementalSource: 'does-not-exist' },
      run: { mode: 'incremental' },
    }));
    expect(result.success).toBe(false);
  });
});

// ── isSingleSource / isMultiSource type guards ────────────────────────────────

describe('isSingleSource / isMultiSource type guards', () => {
  it('isSingleSource returns true for a single-source pipeline', () => {
    const p = PipelineSchema.parse(makeSingleSource());
    expect(isSingleSource(p)).toBe(true);
    expect(isMultiSource(p)).toBe(false);
  });

  it('isMultiSource returns true for a multi-source pipeline', () => {
    const p = PipelineSchema.parse(makeMultiSource());
    expect(isMultiSource(p)).toBe(true);
    expect(isSingleSource(p)).toBe(false);
  });

  it('isSingleSource narrows type so source.adapter is accessible without TS error', () => {
    const p = PipelineSchema.parse(makeSingleSource()) as Pipeline;
    if (isSingleSource(p)) {
      // TypeScript should allow this without a non-null assertion
      const adapter: string = p.source.adapter;
      expect(adapter).toBe('csv');
    }
  });

  it('isMultiSource narrows type so sources and merge are accessible', () => {
    const p = PipelineSchema.parse(makeMultiSource()) as Pipeline;
    if (isMultiSource(p)) {
      expect(p.sources.length).toBeGreaterThanOrEqual(2);
      expect(p.merge.key).toBe('ID');
    }
  });
});
