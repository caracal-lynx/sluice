import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { ConfigLoader } from '../../../src/config/loader.js';
import { ConfigError } from '../../../src/utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../../fixtures');
const sharedRulesPath = path.join(fixturesDir, 'shared-rules.yaml');

describe('Composite rule expansion', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'sluice-composite-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('expands a single composite rule to its constituent checks', async () => {
    const pipelineYaml = `
pipeline:
  name: test-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: ${sharedRulesPath}
  rules:
    - field: STYLE_NO
      checks:
        - type: eribeStyleNo
transform:
  fields:
    - to: StyleNo
      type: constant
      value: TEST
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    const config = await ConfigLoader.load(pipelinePath);
    const rule = config.dq.rules[0];
    expect(rule.field).toBe('STYLE_NO');
    expect(rule.checks).toHaveLength(3); // notNull, pattern, maxLength
    expect(rule.checks.map(c => c.type)).toEqual(['notNull', 'pattern', 'maxLength']);
  });

  it('preserves all expanded check properties (value, severity, message)', async () => {
    const pipelineYaml = `
pipeline:
  name: test-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: ${sharedRulesPath}
  rules:
    - field: PRICE
      checks:
        - type: positivePrice
transform:
  fields:
    - to: Price
      type: constant
      value: "99.99"
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    const config = await ConfigLoader.load(pipelinePath);
    const rule = config.dq.rules[0];
    // positivePrice expands to: notNull (critical), min (critical), max (warning)
    expect(rule.checks).toHaveLength(3);
    expect(rule.checks[0]).toMatchObject({ type: 'notNull', severity: 'critical' });
    expect(rule.checks[1]).toMatchObject({ type: 'min', value: 0, severity: 'critical' });
    expect(rule.checks[2]).toMatchObject({ type: 'max', value: 99999.99, severity: 'warning' });
  });

  it('applies severity override to all expanded checks', async () => {
    const pipelineYaml = `
pipeline:
  name: test-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: ${sharedRulesPath}
  rules:
    - field: PRICE
      checks:
        - type: positivePrice
          severity: info
transform:
  fields:
    - to: Price
      type: constant
      value: "99.99"
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    const config = await ConfigLoader.load(pipelinePath);
    const rule = config.dq.rules[0];
    // All expanded checks should have severity: info
    for (const check of rule.checks) {
      expect(check.severity).toBe('info');
    }
  });

  it('mixes composite and built-in checks in the same field rule', async () => {
    const pipelineYaml = `
pipeline:
  name: test-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: ${sharedRulesPath}
  rules:
    - field: PRICE
      checks:
        - type: notNull
          severity: critical
        - type: positivePrice
        - type: maxLength
          value: 10
          severity: warning
transform:
  fields:
    - to: Price
      type: constant
      value: "99.99"
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    const config = await ConfigLoader.load(pipelinePath);
    const rule = config.dq.rules[0];
    // notNull (built-in) + positivePrice (composite: 3 checks) + maxLength (built-in) = 5 checks
    expect(rule.checks).toHaveLength(5);
    expect(rule.checks[0].type).toBe('notNull');
    expect(rule.checks[1].type).toBe('notNull'); // from positivePrice
    expect(rule.checks[2].type).toBe('min'); // from positivePrice
    expect(rule.checks[3].type).toBe('max'); // from positivePrice
    expect(rule.checks[4].type).toBe('maxLength');
  });

  it('throws ConfigError for unknown rule type', async () => {
    const pipelineYaml = `
pipeline:
  name: test-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: ${sharedRulesPath}
  rules:
    - field: UNKNOWN_FIELD
      checks:
        - type: unknownCompositeRule
transform:
  fields:
    - to: Unknown
      type: constant
      value: "test"
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    await expect(ConfigLoader.load(pipelinePath)).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when rulesFile path does not exist', async () => {
    const pipelineYaml = `
pipeline:
  name: test-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: /nonexistent/rules.yaml
  rules:
    - field: TEST
      checks:
        - type: eribeStyleNo
transform:
  fields:
    - to: Test
      type: constant
      value: "test"
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    await expect(ConfigLoader.load(pipelinePath)).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when rulesFile YAML is invalid', async () => {
    const badRulesYaml = `
version: "1.0"
rules:
  - id: badRule
    checks:
      - { type: notNull
`;
    const badRulesPath = path.join(tmp, 'bad-rules.yaml');
    writeFileSync(badRulesPath, badRulesYaml);

    const pipelineYaml = `
pipeline:
  name: test-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: ${badRulesPath}
  rules:
    - field: TEST
      checks:
        - type: badRule
transform:
  fields:
    - to: Test
      type: constant
      value: "test"
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    await expect(ConfigLoader.load(pipelinePath)).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when rulesFile has duplicate rule ids', async () => {
    const dupRulesYaml = `
version: "1.0"
rules:
  - id: duplicateRule
    checks:
      - { type: notNull, severity: critical }
  - id: duplicateRule
    checks:
      - { type: unique, severity: critical }
`;
    const dupRulesPath = path.join(tmp, 'dup-rules.yaml');
    writeFileSync(dupRulesPath, dupRulesYaml);

    const pipelineYaml = `
pipeline:
  name: test-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: ${dupRulesPath}
  rules:
    - field: TEST
      checks:
        - type: duplicateRule
transform:
  fields:
    - to: Test
      type: constant
      value: "test"
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    await expect(ConfigLoader.load(pipelinePath)).rejects.toThrow(ConfigError);
  });

  it('removes rulesFile from dq object after expansion', async () => {
    const pipelineYaml = `
pipeline:
  name: test-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: ${sharedRulesPath}
  rules:
    - field: STYLE_NO
      checks:
        - type: eribeStyleNo
transform:
  fields:
    - to: StyleNo
      type: constant
      value: TEST
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    const config = await ConfigLoader.load(pipelinePath);
    expect(config.dq.rulesFile).toBeUndefined();
  });

  it('handles pipeline with no dq.rulesFile gracefully', async () => {
    const pipelineYaml = `
pipeline:
  name: test-no-composite
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rules:
    - field: FIELD1
      checks:
        - type: notNull
          severity: critical
transform:
  fields:
    - to: Field1
      type: constant
      value: "test"
target:
  adapter: csv
`;
    const pipelinePath = path.join(tmp, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    const config = await ConfigLoader.load(pipelinePath);
    expect(config.dq.rules).toHaveLength(1);
    expect(config.dq.rules[0].checks[0].type).toBe('notNull');
  });

  it('resolves rulesFile path relative to pipeline file directory', async () => {
    // Create a subdirectory to test relative path resolution
    const subdir = path.join(tmp, 'pipelines');
    const fs = await import('node:fs');
    fs.mkdirSync(subdir, { recursive: true });

    const rulesPath = path.join(tmp, 'custom-rules.yaml');
    const rulesYaml = `
version: "1.0"
rules:
  - id: customRule
    checks:
      - { type: notNull, severity: critical }
`;
    writeFileSync(rulesPath, rulesYaml);

    const pipelineYaml = `
pipeline:
  name: test-relative
  client: test
  version: "1.0"
  entity: Test
source:
  adapter: csv
  file: ./test.csv
dq:
  rulesFile: ../custom-rules.yaml
  rules:
    - field: TEST
      checks:
        - type: customRule
transform:
  fields:
    - to: Test
      type: constant
      value: "test"
target:
  adapter: csv
`;
    const pipelinePath = path.join(subdir, 'pipeline.yaml');
    writeFileSync(pipelinePath, pipelineYaml);

    const config = await ConfigLoader.load(pipelinePath);
    expect(config.dq.rules).toHaveLength(1);
    expect(config.dq.rules[0].checks[0].type).toBe('notNull');
  });
});
