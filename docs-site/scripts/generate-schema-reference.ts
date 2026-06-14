/* eslint-disable no-console */
/**
 * Auto-generate the Pipeline YAML Schema reference page from the canonical
 * Zod schemas in src/config/schema.ts.
 *
 * Output: docs-site/src/content/docs/reference/pipeline-yaml.mdx
 *
 * The page uses MDX (not plain Markdown) because it imports Starlight's
 * `<Aside>` component. Astro only processes `import` statements + JSX
 * inside `.mdx` files; a plain `.md` extension would render the import
 * line as literal text on the published page.
 *
 * Run via:
 *   npx tsx scripts/generate-schema-reference.ts
 *
 * The prebuild/predev hook in package.json runs this automatically.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, type ZodTypeAny } from 'zod';

import {
	DqSchema,
	EnrichSchema,
	MergeSchema,
	MultiSourceEntrySchema,
	RunSchema,
	SourceSchema,
	TargetSchema,
	TransformSchema,
} from '../../src/config/schema.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'src', 'content', 'docs', 'reference', 'pipeline-yaml.mdx');

interface FieldRow {
	name: string;
	type: string;
	required: string;
	default: string;
	description: string;
}

/** Unwrap ZodOptional / ZodDefault wrappers to reveal the inner schema. */
function unwrap(schema: ZodTypeAny): {
	inner: ZodTypeAny;
	isOptional: boolean;
	defaultValue: unknown;
	description: string | undefined;
} {
	let inner: ZodTypeAny = schema;
	let isOptional = false;
	let defaultValue: unknown = undefined;
	let description: string | undefined = (schema._def as { description?: string }).description;

	while (true) {
		const def = inner._def as { typeName?: string; innerType?: ZodTypeAny; defaultValue?: () => unknown; description?: string };
		if (!description && def.description) description = def.description;
		if (def.typeName === 'ZodOptional') {
			isOptional = true;
			inner = def.innerType!;
		} else if (def.typeName === 'ZodDefault') {
			defaultValue = def.defaultValue?.();
			inner = def.innerType!;
		} else if (def.typeName === 'ZodEffects') {
			// .refine() wraps in ZodEffects — the underlying schema is in `schema`
			const eff = def as unknown as { schema: ZodTypeAny };
			inner = eff.schema;
		} else {
			break;
		}
	}
	return { inner, isOptional, defaultValue, description };
}

/** Render a Zod type as a short, human-readable type string. */
function renderType(schema: ZodTypeAny): string {
	const def = schema._def as { typeName?: string; values?: unknown[]; type?: ZodTypeAny; valueType?: ZodTypeAny; options?: ZodTypeAny[] };
	switch (def.typeName) {
		case 'ZodString':
			return 'string';
		case 'ZodNumber':
			return 'number';
		case 'ZodBoolean':
			return 'boolean';
		case 'ZodEnum': {
			const vals = def.values as readonly string[];
			return vals.map((v) => `\`${v}\``).join(' \\| ');
		}
		case 'ZodLiteral': {
			const lit = (def as unknown as { value: unknown }).value;
			return `\`${JSON.stringify(lit)}\``;
		}
		case 'ZodArray': {
			// Unwrap ZodEffects/ZodOptional/ZodDefault around the inner type so refined
			// arrays don't render as "ZodEffects[]".
			const { inner: arrInner } = unwrap(def.type!);
			return `${renderType(arrInner)}[]`;
		}
		case 'ZodRecord':
			// Backtick-wrap so MDX doesn't try to parse `<string` as a JSX
			// tag opener. Markdown table cells happily render inline-code.
			return `\`Record<string, ${renderType(def.valueType!)}>\``;
		case 'ZodUnion': {
			const parts = (def.options ?? []).map(renderType);
			return parts.join(' \\| ');
		}
		case 'ZodObject':
			return 'object';
		case 'ZodUnknown':
			return 'unknown';
		case 'ZodAny':
			return 'any';
		case 'ZodNull':
			return 'null';
		default:
			return def.typeName ?? 'unknown';
	}
}

/** Render the default value in a way that's safe inside a Markdown table cell. */
function renderDefault(value: unknown): string {
	if (value === undefined) return '—';
	if (value === '') return '`""`';
	if (typeof value === 'string') return `\`"${value}"\``;
	if (typeof value === 'object') return `\`${JSON.stringify(value)}\``;
	return `\`${String(value)}\``;
}

/** Walk a ZodObject and produce one row per field. */
function objectRows(schema: ZodTypeAny): FieldRow[] {
	const { inner } = unwrap(schema);
	const def = inner._def as { typeName?: string; shape?: () => Record<string, ZodTypeAny> };
	if (def.typeName !== 'ZodObject' || !def.shape) return [];
	const shape = def.shape();
	return Object.entries(shape).map(([name, fieldSchema]) => {
		const { inner: fInner, isOptional, defaultValue, description } = unwrap(fieldSchema);
		return {
			name,
			type: renderType(fInner),
			required: isOptional || defaultValue !== undefined ? 'no' : 'yes',
			default: renderDefault(defaultValue),
			description: description ?? '',
		};
	});
}

function renderTable(rows: FieldRow[]): string {
	if (rows.length === 0) return '_No fields._\n';
	const header = '| Key | Type | Required | Default | Description |\n|---|---|---|---|---|\n';
	const body = rows
		.map(
			(r) =>
				`| \`${r.name}\` | ${r.type} | ${r.required} | ${r.default} | ${r.description.replace(/\n/g, ' ').replace(/\|/g, '\\|')} |`,
		)
		.join('\n');
	return header + body + '\n';
}

function renderSection(
	heading: string,
	intro: string,
	schema: ZodTypeAny,
): string {
	const rows = objectRows(schema);
	return `## ${heading}\n\n${intro}\n\n${renderTable(rows)}\n`;
}

const sections = [
	renderSection(
		'`source` — single-source pipelines',
		'Where the data comes from. Exactly one of `query`, `file`, or `endpoint` must be set. See [Source Adapters](/sluice/reference/source-adapters/) for adapter-specific config.',
		SourceSchema,
	),
	renderSection(
		'`sources[]` — multi-source pipelines',
		'In multi-source mode, replace `source:` with a `sources:` array (minimum two entries). Each entry inherits the single-source `source` keys above plus the three multi-source-only keys below: `id`, `priority`, and `rename`. Mutually exclusive with `source`.',
		MultiSourceEntrySchema,
	),
	renderSection(
		'`merge` — multi-source merge config',
		'Required whenever `sources` is set. See [How It Works](/sluice/architecture/how-it-works/) for the merge flow diagram.',
		MergeSchema,
	),
	renderSection(
		'`dq` — data quality',
		'See [Data Quality Rules](/sluice/reference/dq-rules/) for the full check-type reference.',
		DqSchema,
	),
	renderSection(
		'`enrich` — Phase 4a (paid add-on)',
		'Optional. Runs between Extract (or Merge) and DQ. The framework that consumes this block lives in the private `@caracal-lynx/sluice-enrich` package; with that not installed, an `enrich:` block is parsed and validated but the phase is skipped with a `WARN` log.',
		EnrichSchema,
	),
	renderSection(
		'`transform`',
		'Field mappings, lookups, transforms, and cleanse ops. See [Transforms](/sluice/reference/transforms/) for every available type.',
		TransformSchema,
	),
	renderSection(
		'`target`',
		'Where the data goes. See [Target Adapters](/sluice/reference/target-adapters/) for adapter-specific config.',
		TargetSchema,
	),
	renderSection(
		'`run` — execution options',
		'Every field is optional with a sensible default; you can omit the entire `run:` block.',
		RunSchema,
	),
];

const HEADER = `---
title: Pipeline YAML Schema
description: Definitive reference for every key in a Sluice pipeline YAML — auto-generated from the Zod schema in the source code.
---

import { Aside } from '@astrojs/starlight/components';

{/*
  AUTO-GENERATED FILE.
  Generated by docs-site/scripts/generate-schema-reference.ts from
  src/config/schema.ts. Do not hand-edit; edit the .describe() calls in
  schema.ts to change descriptions, then re-run \`pnpm --filter docs-site build\`
  (or \`pnpm --filter docs-site predev\`) to regenerate.
*/}

This page is the definitive, searchable reference for every key in a Sluice pipeline YAML. It is **auto-generated from the Zod schema** in [\`src/config/schema.ts\`](https://github.com/caracal-lynx/sluice/blob/master/src/config/schema.ts) so it cannot drift from the code.

<Aside type="note" title="Generated content">
Field descriptions come from \`.describe()\` calls in the Zod schema. If a row's description is blank, contribute a description by adding a \`.describe('…')\` to the corresponding field in [\`src/config/schema.ts\`](https://github.com/caracal-lynx/sluice/blob/master/src/config/schema.ts).
</Aside>

## Top-level structure

\`\`\`yaml
pipeline:   { ... }   # identity and metadata (always required)
source:     { ... }   # single-source mode (mutually exclusive with sources+merge)
sources:    [ ... ]   # multi-source mode — minimum two entries
merge:      { ... }   # required when sources is present
enrich:     { ... }   # OPTIONAL — Phase 4a; private add-on
dq:         { ... }   # data quality rules
transform:  { ... }   # field mappings, lookups, transforms
target:     { ... }   # load destination
run:        { ... }   # execution options (defaults provided)
\`\`\`

## \`pipeline\` — identity and metadata

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| \`name\` | string (lowercase, hyphenated) | yes | — | Pipeline slug used in output filenames and log records. Must match \`^[a-z0-9-]+$\`. |
| \`client\` | string | yes | — | Client identifier; appears in load reports and run state. |
| \`version\` | string | yes | — | Pipeline version (quote in YAML to keep it a string). |
| \`entity\` | string | yes | — | Logical entity name (used in load reports and target adapter metadata). |
| \`description\` | string | no | — | Human-readable description. |
`;

const FOOTER = `## Worked example

A complete single-source pipeline migrating customers from MSSQL to IFS via the paid \`ifs\` adapter:

\`\`\`yaml
pipeline:
  name: acme-corp-customers
  client: acme-corp
  version: "1.0"
  entity: CustomerInfo
  description: Customer master — legacy SQL to IFS ERP

source:
  adapter: mssql
  connection: \${SOURCE_MSSQL}
  query: |
    SELECT c.CUST_CODE, c.CUST_NAME, c.POST_CODE, c.EMAIL, c.CREDIT_LIMIT
    FROM dbo.Customers c
    WHERE c.Active = 1 AND c.DELETED = 0

dq:
  stopOnCritical: true
  rejectionFile: ./output/acme-corp-customers-rejected.csv
  rules:
    - field: CUST_CODE
      checks:
        - { type: notNull, severity: critical }
        - { type: unique,  severity: critical }
    - field: EMAIL
      checks:
        - { type: email, severity: warning }

transform:
  fields:
    - { from: CUST_CODE, to: CustomerNo, type: string, max: 20 }
    - { from: CUST_NAME, to: Name,       type: string, cleanse: trim|titleCase }
    - { from: EMAIL,     to: Email,      type: string, cleanse: trim|lowercase }
    - { to: CustomerGroup, type: constant, value: DOMESTIC }

target:
  adapter: ifs
  entity: CustomerInfo
  output: ./output/acme-corp-customers-ifs.csv
  includeHeader: false
  columnOrder: [CustomerNo, Name, Email, CustomerGroup]

run:
  mode: full
  batchSize: 500
  logLevel: info
\`\`\`

## See also

- [Source Adapters](/sluice/reference/source-adapters/)
- [Target Adapters](/sluice/reference/target-adapters/)
- [Data Quality Rules](/sluice/reference/dq-rules/)
- [Transforms](/sluice/reference/transforms/)
- [Writing a Pipeline YAML](/sluice/guides/writing-pipelines/)
`;

const body = HEADER + '\n' + sections.join('\n---\n\n') + '\n' + FOOTER;

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, body, 'utf-8');
console.log(`✓ Wrote ${OUTPUT_PATH}`);

// Type guard so `z` is reachable in case the bundler tree-shakes the import.
void z;
