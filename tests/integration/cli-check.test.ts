import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createRunnerForPipeline } from "../../src/cli.js";
import { ConfigLoader } from "../../src/config/loader.js";
import { MultiSourcePipelineRunner } from "../../src/multi-source-runner.js";

describe("CLI check-oriented multi-source validation", () => {
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const fixturesDir = path.resolve(__dirname, "../fixtures");

  it("accepts a valid multi-source pipeline via config validation", async () => {
    const fixture = path.join(fixturesDir, "style-co-products-merged.pipeline.yaml");
    const raw = readFileSync(fixture, "utf-8").replace(/\$\{[^}]+\}/g, "placeholder");
    const tmpYaml = join(tmpdir(), "sluice-cli-check-valid-multi-source.pipeline.yaml");
    writeFileSync(tmpYaml, raw, "utf-8");

    const config = await ConfigLoader.load(tmpYaml);

    expect(config.pipeline.name).toBe("style-co-products-merged");
    expect(config.sources).toHaveLength(3);
    expect(config.merge?.strategy).toBe("coalesce");
  });

  it("rejects a multi-source pipeline with no merge section", async () => {
    const fixture = path.join(fixturesDir, "multi-source-no-merge.pipeline.yaml");

    await expect(ConfigLoader.load(fixture)).rejects.toThrow(
      /pipeline must have either source \(single\) or both sources and merge \(multi\)/i,
    );
  });

  it("defers validation of a structurally invalid multi-source config to the load", async () => {
    const fixture = path.join(fixturesDir, "multi-source-no-merge.pipeline.yaml");

    // Runner selection is structural only. It must NOT validate: it runs before
    // any plugin is registered, and ConfigLoader now rejects unregistered rule
    // and adapter ids (DAG-344), so validating here would reject every plugin
    // pipeline before the runner that loads the plugins exists. The invalid
    // config is still rejected one step later — before any extract work.
    const runner = await createRunnerForPipeline(fixture);
    expect(runner).toBeInstanceOf(MultiSourcePipelineRunner);
    await expect(runner.run(fixture)).rejects.toThrow(
      /pipeline must have either source \(single\) or both sources and merge \(multi\)/i,
    );
  });
});
