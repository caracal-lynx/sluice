import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../fixtures');

// Mock node:fs/promises before importing loader
vi.mock('node:fs/promises');

// Import after mock is set up
const { readFile } = await import('node:fs/promises');
const { ConfigLoader } = await import('../../../src/config/loader.js');
const { ConfigError } = await import('../../../src/utils/errors.js');

const mockReadFile = vi.mocked(readFile);

// Minimal valid pipeline YAML (no env vars needed)
const MINIMAL_YAML = `
pipeline:
  name: test-pipeline
  client: test-client
  version: "1.0"
  entity: TestEntity
source:
  adapter: csv
  file: ./data/test.csv
dq:
  rules: []
transform:
  fields:
    - from: id
      to: Id
      type: string
target:
  adapter: csv
`;

// Pipeline YAML with env var tokens
const ENV_VAR_YAML = `
pipeline:
  name: test-env-pipeline
  client: test-client
  version: "1.0"
  entity: TestEntity
source:
  adapter: mssql
  connection: \${TEST_CONN_STR}
  query: "SELECT 1"
dq:
  rules: []
transform:
  fields:
    - from: id
      to: Id
      type: string
target:
  adapter: csv
`;

describe('ConfigLoader.load()', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe('happy path', () => {
    it('loads and parses a minimal valid pipeline', async () => {
      mockReadFile.mockResolvedValueOnce(MINIMAL_YAML as unknown as Buffer);
      const result = await ConfigLoader.load('/any/path.yaml');
      expect(result.pipeline.name).toBe('test-pipeline');
      expect(result.run.mode).toBe('full'); // default applied
    });

    it('resolves ${ENV_VAR} tokens from process.env', async () => {
      vi.stubEnv('TEST_CONN_STR', 'mssql://user:pass@server/db');
      mockReadFile.mockResolvedValueOnce(ENV_VAR_YAML as unknown as Buffer);
      const result = await ConfigLoader.load('/any/path.yaml');
      expect(result.source.connection).toBe('mssql://user:pass@server/db');
    });

    it('passes the yamlPath to readFile', async () => {
      mockReadFile.mockResolvedValueOnce(MINIMAL_YAML as unknown as Buffer);
      await ConfigLoader.load('/specific/path/pipeline.yaml');
      expect(mockReadFile).toHaveBeenCalledWith('/specific/path/pipeline.yaml', 'utf-8');
    });
  });

  describe('error cases', () => {
    it('throws ConfigError when file is not found (ENOENT)', async () => {
      const enoentError = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      mockReadFile.mockRejectedValue(enoentError);
      const err = await ConfigLoader.load('/nonexistent/path.yaml').catch(e => e);
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.message).toContain('Pipeline file not found');
    });

    it('rethrows non-ENOENT fs errors', async () => {
      const permError = Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      });
      mockReadFile.mockRejectedValueOnce(permError);
      await expect(ConfigLoader.load('/restricted/path.yaml')).rejects.toThrow('EACCES');
      // Should NOT be a ConfigError for permission errors
    });

    it('throws ConfigError when env var is missing', async () => {
      // TEST_CONN_STR not stubbed — should be absent from process.env
      delete process.env['TEST_CONN_STR'];
      mockReadFile.mockResolvedValue(ENV_VAR_YAML as unknown as Buffer);
      const err = await ConfigLoader.load('/any/path.yaml').catch(e => e);
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.message).toContain('TEST_CONN_STR');
    });

    it('throws ConfigError for invalid YAML syntax', async () => {
      const badYaml = 'pipeline:\n  name: bad\n  : invalid: yaml: here';
      mockReadFile.mockResolvedValueOnce(badYaml as unknown as Buffer);
      await expect(ConfigLoader.load('/any/path.yaml')).rejects.toThrow(ConfigError);
    });

    it('propagates ZodError for valid YAML that fails schema validation', async () => {
      const invalidSchema = `
pipeline:
  name: INVALID_NAME_UPPERCASE
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rules: []
transform:
  fields:
    - from: id
      to: Id
      type: string
target:
  adapter: csv
`;
      mockReadFile.mockResolvedValueOnce(invalidSchema as unknown as Buffer);
      await expect(ConfigLoader.load('/any/path.yaml')).rejects.toThrow(ZodError);
    });
  });

  describe('Phase 3 prep Change 2 — sourceId on DQ rules', () => {
    it('parses a DQ rule with `sourceId: sql-server` without error', async () => {
      const yaml = `
pipeline:
  name: test
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./t.csv
dq:
  rules:
    - field: CUST_CODE
      sourceId: sql-server
      checks:
        - { type: notNull, severity: critical }
transform:
  fields:
    - { from: id, to: Id, type: string }
target:
  adapter: csv
`;
      mockReadFile.mockResolvedValueOnce(yaml as unknown as Buffer);
      const result = await ConfigLoader.load('/any/path.yaml');
      // @ts-expect-error — sourceId is on the inferred type after Phase 3 prep
      expect(result.dq.rules[0].sourceId).toBe('sql-server');
    });
  });

  describe('integration: real fixture content', () => {
    it('processes acme-corp-customers.pipeline.yaml content correctly', async () => {
      const content = readFileSync(
        path.join(fixturesDir, 'acme-corp-customers.pipeline.yaml'),
        'utf-8',
      );
      vi.stubEnv('COCHRAN_MSSQL', 'mssql://user:pass@legacy.example.local/LegacyDB');
      mockReadFile.mockResolvedValueOnce(content as unknown as Buffer);

      const result = await ConfigLoader.load('/fake/acme-corp-customers.pipeline.yaml');
      expect(result.pipeline.name).toBe('acme-corp-customers');
      expect(result.source.adapter).toBe('mssql');
      expect(result.source.connection).toBe('mssql://user:pass@legacy.example.local/LegacyDB');
      expect(result.dq.rules).toHaveLength(6);
      expect(result.transform.fields).toHaveLength(11);
      expect(result.target.adapter).toBe('ifs');
    });

    it('processes style-co-styles.pipeline.yaml content correctly', async () => {
      const content = readFileSync(
        path.join(fixturesDir, 'style-co-styles.pipeline.yaml'),
        'utf-8',
      );
      mockReadFile.mockResolvedValueOnce(content as unknown as Buffer);

      const result = await ConfigLoader.load('/fake/style-co-styles.pipeline.yaml');
      expect(result.pipeline.name).toBe('style-co-styles');
      expect(result.source.adapter).toBe('csv');
      expect(result.dq.rules).toHaveLength(6);
      expect(result.transform.fields).toHaveLength(12);
      expect(result.target.adapter).toBe('bluecherry');
    });
  });
});
