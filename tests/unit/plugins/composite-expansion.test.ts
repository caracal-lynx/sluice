import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");

// Mock node:fs/promises before importing loader
vi.mock("node:fs/promises");

const { readFile } = await import("node:fs/promises");
const { ConfigLoader } = await import("../../../src/config/loader.js");
const { ConfigError } = await import("../../../src/utils/errors.js");

const mockReadFile = vi.mocked(readFile);

// Shared rule library content (loaded once for reuse in tests)
const SHARED_RULES_YAML = readFileSync(path.join(fixturesDir, "shared-rules.yaml"), "utf-8");

/**
 * Install a readFile mock that dispatches by path substring. More robust than
 * mockResolvedValueOnce chains — doesn't care about the order the loader
 * happens to read files in.
 */
const installReadFileByPath = (entries: Record<string, string | Error>) => {
  mockReadFile.mockImplementation(async (p: unknown) => {
    const pathStr = String(p);
    for (const [needle, value] of Object.entries(entries)) {
      if (pathStr.includes(needle)) {
        if (value instanceof Error) throw value;
        return value as unknown as Buffer;
      }
    }
    throw new Error(`Unexpected readFile call: ${pathStr}`);
  });
};

// Pipeline YAML that references the shared rules file and uses composite checks
const makePipelineWithCompositeRules = (checks: string, extraDqFields = "") => `
pipeline:
  name: test-pipeline
  client: test-client
  version: "1.0"
  entity: TestEntity
source:
  adapter: csv
  file: ./data/test.csv
dq:
  rulesFile: ../../shared/rules.yaml
  ${extraDqFields}
  rules:
    - field: STYLE_NO
      checks:
        ${checks}
transform:
  fields:
    - from: STYLE_NO
      to: StyleNo
      type: string
target:
  adapter: csv
`;

// Pipeline YAML with NO rulesFile — regression guard
const PIPELINE_NO_RULES_FILE = `
pipeline:
  name: test-pipeline
  client: test-client
  version: "1.0"
  entity: TestEntity
source:
  adapter: csv
  file: ./data/test.csv
dq:
  rules:
    - field: ID
      checks:
        - { type: notNull, severity: critical }
transform:
  fields:
    - from: ID
      to: Id
      type: string
target:
  adapter: csv
`;

describe("Composite rule expansion", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("expands a single composite rule to its constituent checks", async () => {
    const pipeline = makePipelineWithCompositeRules("- { type: styleCoStyleNo }");
    installReadFileByPath({
      "pipeline.yaml": pipeline,
      "rules.yaml": SHARED_RULES_YAML,
    });

    const result = await ConfigLoader.load("/fake/pipeline.yaml");
    const checks = result.dq.rules[0].checks;

    // styleCoStyleNo expands to 3 checks: notNull, pattern, maxLength
    expect(checks).toHaveLength(3);
    expect(checks[0].type).toBe("notNull");
    expect(checks[1].type).toBe("pattern");
    expect(checks[2].type).toBe("maxLength");
  });

  it("drops dq.rulesFile from the parsed config after expansion", async () => {
    const pipeline = makePipelineWithCompositeRules("- { type: styleCoStyleNo }");
    installReadFileByPath({
      "pipeline.yaml": pipeline,
      "rules.yaml": SHARED_RULES_YAML,
    });

    const result = await ConfigLoader.load("/fake/pipeline.yaml");
    expect((result.dq as { rulesFile?: string }).rulesFile).toBeUndefined();
  });

  it("applies a severity override to ALL checks when present on the composite entry", async () => {
    // ifsCustomerNo has: notNull(critical), unique(critical), pattern(warning)
    // Override to 'warning' should downgrade all three
    const pipeline = makePipelineWithCompositeRules("- { type: ifsCustomerNo, severity: warning }");
    installReadFileByPath({
      "pipeline.yaml": pipeline,
      "rules.yaml": SHARED_RULES_YAML,
    });

    const result = await ConfigLoader.load("/fake/pipeline.yaml");
    const checks = result.dq.rules[0].checks;

    expect(checks).toHaveLength(3);
    for (const check of checks) {
      expect(check.severity).toBe("warning");
    }
  });

  it("handles mixed composite + built-in checks in the same field rule", async () => {
    const pipeline = makePipelineWithCompositeRules(`
        - { type: styleCoStyleNo }
        - { type: unique, severity: critical }
    `);
    installReadFileByPath({
      "pipeline.yaml": pipeline,
      "rules.yaml": SHARED_RULES_YAML,
    });

    const result = await ConfigLoader.load("/fake/pipeline.yaml");
    const checks = result.dq.rules[0].checks;

    // 3 from styleCoStyleNo + 1 built-in unique = 4
    expect(checks).toHaveLength(4);
    expect(checks[0].type).toBe("notNull");
    expect(checks[1].type).toBe("pattern");
    expect(checks[2].type).toBe("maxLength");
    expect(checks[3].type).toBe("unique");
  });

  it("throws ConfigError for an unknown composite rule id, with helpful message", async () => {
    const pipeline = makePipelineWithCompositeRules("- { type: unknownRule, severity: critical }");
    installReadFileByPath({
      "pipeline.yaml": pipeline,
      "rules.yaml": SHARED_RULES_YAML,
    });

    const err = await ConfigLoader.load("/fake/pipeline.yaml").catch((e) => e);

    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("unknownRule");
    // Should list available composite rule ids
    expect(err.message).toContain("styleCoStyleNo");
    expect(err.message).toContain("positivePrice");
    expect(err.message).toContain("ifsCustomerNo");
  });

  it("throws ConfigError when rulesFile does not exist", async () => {
    const pipeline = makePipelineWithCompositeRules("- { type: styleCoStyleNo }");
    const enoentError = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });

    installReadFileByPath({
      "pipeline.yaml": pipeline,
      "rules.yaml": enoentError,
    });

    const err = await ConfigLoader.load("/fake/pipeline.yaml").catch((e) => e);

    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("rulesFile not found");
  });

  it("throws ConfigError when the rules library has duplicate ids", async () => {
    const dupLibrary = `
version: "1.0"
rules:
  - id: dup
    checks:
      - { type: notNull, severity: critical }
  - id: dup
    checks:
      - { type: unique, severity: critical }
`;
    const pipeline = makePipelineWithCompositeRules("- { type: dup }");
    installReadFileByPath({
      "pipeline.yaml": pipeline,
      "rules.yaml": dupLibrary,
    });

    const err = await ConfigLoader.load("/fake/pipeline.yaml").catch((e) => e);

    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("Duplicate composite rule id");
    expect(err.message).toContain("dup");
  });

  it("a valid rulesFile parses correctly against CompositeRuleLibrarySchema", async () => {
    // Load the fixture directly to verify the schema accepts it
    const { CompositeRuleLibrarySchema } = await import("../../../src/config/schema.js");
    const { load: yamlLoad } = await import("js-yaml");

    const library = CompositeRuleLibrarySchema.parse(yamlLoad(SHARED_RULES_YAML));

    expect(library.version).toBe("1.0");
    expect(library.rules).toHaveLength(3);
    expect(library.rules.map((r) => r.id)).toEqual(
      expect.arrayContaining(["styleCoStyleNo", "positivePrice", "ifsCustomerNo"]),
    );
    expect(library.rules[0].checks.length).toBeGreaterThan(0);
  });

  it("loads correctly when no rulesFile key is present (regression guard)", async () => {
    mockReadFile.mockResolvedValueOnce(PIPELINE_NO_RULES_FILE as unknown as Buffer);

    const result = await ConfigLoader.load("/fake/pipeline.yaml");

    // readFile should only have been called once (no rulesFile read)
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(result.dq.rules[0].checks[0].type).toBe("notNull");
  });
});
