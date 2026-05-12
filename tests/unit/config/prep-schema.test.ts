import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { PipelineSchema, PrepSchema } from '../../../src/config/schema.js';

const minimalSingleSource = {
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
  dq: { rules: [] },
  transform: {
    fields: [{ from: 'id', to: 'Id', type: 'string' }],
  },
  target: { adapter: 'csv' },
};

const minimalMultiSource = {
  pipeline: {
    name: 'multi-test',
    client: 'test-client',
    version: '1.0',
    entity: 'TestEntity',
  },
  sources: [
    {
      id: 'a',
      priority: 1,
      adapter: 'csv',
      file: './data/a.csv',
    },
    {
      id: 'b',
      priority: 2,
      adapter: 'csv',
      file: './data/b.csv',
    },
  ],
  merge: { key: 'id' },
  dq: { rules: [] },
  transform: {
    fields: [{ from: 'id', to: 'Id', type: 'string' }],
  },
  target: { adapter: 'csv' },
};

describe('PrepSchema', () => {
  describe('single-rule shapes', () => {
    it('accepts a minimal cleanse rule', () => {
      const raw = {
        rules: [{ field: 'HC_CODE', cleanse: 'padEnd:10:0' }],
      };
      const result = PrepSchema.parse(raw);
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.cleanse).toBe('padEnd:10:0');
      expect(result.rules[0]!.onMiss).toBe('keep');
      expect(result.lookups).toEqual([]);
      expect(result.summaryFile).toBeUndefined();
    });

    it('accepts a minimal expression rule', () => {
      const raw = {
        rules: [{ field: 'HC_CODE', expression: 'row.HC_CODE.trim()' }],
      };
      expect(() => PrepSchema.parse(raw)).not.toThrow();
    });

    it('accepts a minimal lookup rule', () => {
      const raw = {
        lookups: [
          {
            name: 'fixups',
            source: { adapter: 'csv', file: './lookups/fixups.csv' },
            key: 'old',
            value: 'new',
          },
        ],
        rules: [{ field: 'HC_CODE', lookup: 'fixups' }],
      };
      expect(() => PrepSchema.parse(raw)).not.toThrow();
    });

    it('accepts an explicit onMiss on a lookup rule', () => {
      const raw = {
        rules: [{ field: 'HC_CODE', lookup: 'fixups', onMiss: 'error' }],
      };
      expect(() => PrepSchema.parse(raw)).not.toThrow();
    });

    it('accepts a when predicate', () => {
      const raw = {
        rules: [
          {
            field: 'HC_CODE',
            when: 'row.HC_CODE.length === 8',
            cleanse: 'padEnd:10:0',
          },
        ],
      };
      expect(() => PrepSchema.parse(raw)).not.toThrow();
    });
  });

  describe('rule-shape refinement', () => {
    it('rejects a rule with zero ops', () => {
      const raw = { rules: [{ field: 'HC_CODE' }] };
      expect(() => PrepSchema.parse(raw)).toThrow(ZodError);
    });

    it('rejects a rule with two ops (cleanse + expression)', () => {
      const raw = {
        rules: [
          {
            field: 'HC_CODE',
            cleanse: 'trim',
            expression: 'row.HC_CODE',
          },
        ],
      };
      expect(() => PrepSchema.parse(raw)).toThrow(ZodError);
    });

    it('rejects a rule with two ops (cleanse + lookup)', () => {
      const raw = {
        rules: [{ field: 'HC_CODE', cleanse: 'trim', lookup: 'fixups' }],
      };
      expect(() => PrepSchema.parse(raw)).toThrow(ZodError);
    });

    it('rejects a rule with all three ops', () => {
      const raw = {
        rules: [
          {
            field: 'HC_CODE',
            cleanse: 'trim',
            expression: 'row.HC_CODE',
            lookup: 'fixups',
          },
        ],
      };
      expect(() => PrepSchema.parse(raw)).toThrow(ZodError);
    });

    it('rejects onMiss on a cleanse-only rule', () => {
      const raw = {
        rules: [{ field: 'HC_CODE', cleanse: 'trim', onMiss: 'null' }],
      };
      expect(() => PrepSchema.parse(raw)).toThrow(ZodError);
    });

    it('rejects onMiss on an expression-only rule', () => {
      const raw = {
        rules: [
          { field: 'HC_CODE', expression: 'row.HC_CODE', onMiss: 'error' },
        ],
      };
      expect(() => PrepSchema.parse(raw)).toThrow(ZodError);
    });

    it('accepts omitted onMiss (defaults to keep) on a non-lookup rule', () => {
      const raw = { rules: [{ field: 'HC_CODE', cleanse: 'trim' }] };
      const result = PrepSchema.parse(raw);
      expect(result.rules[0]!.onMiss).toBe('keep');
    });
  });

  describe('block-level constraints', () => {
    it('rejects an empty rules array', () => {
      const raw = { rules: [] };
      expect(() => PrepSchema.parse(raw)).toThrow(ZodError);
    });

    it('defaults lookups to []', () => {
      const raw = { rules: [{ field: 'HC_CODE', cleanse: 'trim' }] };
      const result = PrepSchema.parse(raw);
      expect(result.lookups).toEqual([]);
    });

    it('summaryFile is optional', () => {
      const raw = { rules: [{ field: 'HC_CODE', cleanse: 'trim' }] };
      const result = PrepSchema.parse(raw);
      expect(result.summaryFile).toBeUndefined();
    });

    it('accepts an explicit summaryFile', () => {
      const raw = {
        rules: [{ field: 'HC_CODE', cleanse: 'trim' }],
        summaryFile: './output/custom-prep-summary.json',
      };
      const result = PrepSchema.parse(raw);
      expect(result.summaryFile).toBe('./output/custom-prep-summary.json');
    });
  });
});

describe('PipelineSchema with prep', () => {
  it('accepts a single-source pipeline with prep (no sourceId)', () => {
    const raw = {
      ...minimalSingleSource,
      prep: { rules: [{ field: 'HC_CODE', cleanse: 'padEnd:10:0' }] },
    };
    expect(() => PipelineSchema.parse(raw)).not.toThrow();
  });

  it('accepts a multi-source pipeline with prep rules scoped by sourceId', () => {
    const raw = {
      ...minimalMultiSource,
      prep: {
        rules: [
          { field: 'HC_CODE', sourceId: 'a', cleanse: 'padEnd:10:0' },
          { field: 'STYLE_NO', sourceId: 'b', cleanse: 'trim' },
        ],
      },
    };
    expect(() => PipelineSchema.parse(raw)).not.toThrow();
  });

  it('accepts a multi-source pipeline with post-merge rules (no sourceId)', () => {
    const raw = {
      ...minimalMultiSource,
      prep: {
        rules: [{ field: 'HC_CODE', cleanse: 'padEnd:10:0' }],
      },
    };
    expect(() => PipelineSchema.parse(raw)).not.toThrow();
  });

  it('rejects sourceId on a single-source pipeline', () => {
    const raw = {
      ...minimalSingleSource,
      prep: {
        rules: [{ field: 'HC_CODE', sourceId: 'something', cleanse: 'trim' }],
      },
    };
    expect(() => PipelineSchema.parse(raw)).toThrow(ZodError);
  });

  it('rejects sourceId that does not match a declared source id', () => {
    const raw = {
      ...minimalMultiSource,
      prep: {
        rules: [{ field: 'HC_CODE', sourceId: 'nonexistent', cleanse: 'trim' }],
      },
    };
    expect(() => PipelineSchema.parse(raw)).toThrow(ZodError);
  });

  it('omitting prep block is allowed (no-op)', () => {
    expect(() => PipelineSchema.parse(minimalSingleSource)).not.toThrow();
  });
});
