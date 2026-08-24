// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * DAG-344: the whole point — a plugin-contributed rule id named in a pipeline
 * YAML must load AND run.
 *
 * Before this, `CheckSchema.type` was a closed enum of the nine built-ins, so
 * `ConfigLoader.load()` rejected the config before the DQ engine — which has
 * always consulted the rule registry — could ever reach the plugin. Three rule
 * packs shipped with 201 passing tests and not one of their rules could be
 * referenced from a pipeline.
 *
 * A file (Tier 2) plugin is used rather than one of the real `etl-rules-*`
 * packs: those peer on sluice, so depending on one here would be circular. The
 * mechanism under test — registry lookup at config-load time — is identical.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { PipelineRunner } from "../../src/runner.js";
import { ConfigError } from "../../src/utils/errors.js";

let dir = "";

const RULE_PLUGIN = `
export const rule = {
  id: "evenLength",
  validate(value, config, rowIndex, field) {
    if (value === null || value === undefined || value === "") return null;
    return String(value).length % 2 === 0
      ? null
      : { field, rowIndex, value, rule: "evenLength", severity: config.severity,
          message: config.message ?? field + " must have an even number of characters" };
  },
};
`;

function pipelineYaml(checkType: string): string {
  // Absolute paths: source `file` and `run.outputDir` resolve against the process
  // cwd, not the pipeline's directory, and the fixture lives in a temp dir.
  const p = (f: string): string => path.join(dir, f).split(path.sep).join("/");
  return `
pipeline:
  name: plugin-rule-e2e
  client: test
  version: "1.0"
  entity: Thing
source:
  adapter: csv
  file: ${p("in.csv")}
dq:
  stopOnCritical: false
  rules:
    - field: code
      checks:
        - type: ${checkType}
          severity: warning
transform:
  fields:
    - from: code
      to: Code
      type: string
target:
  adapter: csv
  output: ${p("out.csv")}
run:
  outputDir: ${p("out")}
`;
}

async function writePipeline(checkType: string): Promise<string> {
  const yamlPath = path.join(dir, "p.pipeline.yaml");
  await fs.writeFile(yamlPath, pipelineYaml(checkType), "utf-8");
  return yamlPath;
}

describe("plugin rule ids in a pipeline config", () => {
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "sluice-plugin-rule-"));
    await fs.mkdir(path.join(dir, "plugins"), { recursive: true });
    await fs.writeFile(path.join(dir, "plugins", "evenLength.rule.js"), RULE_PLUGIN, "utf-8");
    // "odd" is 3 chars → one warning; "even" is 4 → clean.
    await fs.writeFile(path.join(dir, "in.csv"), "code\nodd\neven\n", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("loads the config and runs the plugin rule against the data", async () => {
    const yamlPath = await writePipeline("evenLength");

    const result = await new PipelineRunner().run(yamlPath);

    expect(result.dq.rowsChecked).toBe(2);
    expect(result.dq.violations.warning).toBe(1);
    // Proves the engine reached the PLUGIN, not a built-in that happened to pass.
    expect(result.dq.violations.critical).toBe(0);
  });

  it("still rejects an unknown check id at config-load time, naming where to look", async () => {
    const yamlPath = await writePipeline("evenLenght");

    await expect(new PipelineRunner().run(yamlPath)).rejects.toThrow(ConfigError);
    await expect(new PipelineRunner().run(yamlPath)).rejects.toThrow(
      /Unknown DQ check type "evenLenght".*Registered plugin rules: .*evenLength/s,
    );
  });

  it("still rejects a typo in a BUILT-IN check id at config-load time", async () => {
    const yamlPath = await writePipeline("notNul");

    await expect(new PipelineRunner().run(yamlPath)).rejects.toThrow(
      /Unknown DQ check type "notNul".*Built-in: \[notNull, /s,
    );
  });
});
