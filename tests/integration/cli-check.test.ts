import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRunnerForPipeline } from '../../src/cli.js';
import { ConfigLoader } from '../../src/config/loader.js';

describe('CLI check-oriented multi-source validation', () => {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const fixturesDir = path.resolve(__dirname, '../fixtures');

  it('accepts a valid multi-source pipeline via config validation', async () => {
    const fixture = path.join(fixturesDir, 'style-co-products-merged.pipeline.yaml');
    const raw = readFileSync(fixture, 'utf-8').replace(/\$\{[^}]+\}/g, 'placeholder');
    const tmpYaml = join(tmpdir(), 'sluice-cli-check-valid-multi-source.pipeline.yaml');
    writeFileSync(tmpYaml, raw, 'utf-8');

    const config = await ConfigLoader.load(tmpYaml);

    expect(config.pipeline.name).toBe('style-co-products-merged');
    expect(config.sources).toHaveLength(3);
    expect(config.merge?.strategy).toBe('coalesce');
  });

  it('rejects a multi-source pipeline with no merge section', async () => {
    const fixture = path.join(fixturesDir, 'multi-source-no-merge.pipeline.yaml');

    await expect(ConfigLoader.load(fixture)).rejects.toThrow(
      /pipeline must have either source \(single\) or both sources and merge \(multi\)/i,
    );
  });

  it('fails runner selection for a structurally invalid multi-source config', async () => {
    const fixture = path.join(fixturesDir, 'multi-source-no-merge.pipeline.yaml');

    await expect(createRunnerForPipeline(fixture)).rejects.toThrow(
      /pipeline must have either source \(single\) or both sources and merge \(multi\)/i,
    );
  });
});
