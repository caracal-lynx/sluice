/**
 * TransformEngine — reads rows from `sourceTable`, applies field mappings
 * (cleanse ops, type coercion, lookups, expressions, constants, concat, custom
 * plugins), and writes to `targetTable`.
 *
 * Phase 3 prep Change 4: both table names are parameters (defaulting to
 * `stg_raw` / `stg_transformed`) so Phase 3 can pipe merged data through
 * the same engine.
 *
 * Phase 1 note: every output column is stored as VARCHAR in the staging
 * store. Target adapters re-emit as needed; DuckDB serialises values
 * losslessly through the string representation.
 */

import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

import { TransformRegistry } from '../plugins/registry.js';
import type { CustomFieldMapping, TransformPlugin } from '../plugins/types.js';
import type { FieldMapping, Pipeline } from '../config/types.js';
import type { ColumnMeta, StagingStore } from '../staging/index.js';
import { quoteIdent } from '../staging/index.js';
import { TransformError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { applyCleanse } from './cleanse.js';
import { ExpressionEvaluator } from './expression.js';
import { LookupResolver } from './lookup.js';
import type { TransformResult } from './types.js';

dayjs.extend(customParseFormat);

export class TransformEngine {
  constructor(private readonly transforms: TransformRegistry = new TransformRegistry()) {}

  async run(
    config: Pipeline,
    store: StagingStore,
    sourceTable = 'stg_raw',
    targetTable = 'stg_transformed',
  ): Promise<TransformResult> {
    const lookups = new LookupResolver();
    await lookups.loadAll(config, config.run);

    const expressionEval = new ExpressionEvaluator();

    const outputColumns: ColumnMeta[] = config.transform.fields.map((f) => ({
      name: f.to,
      duckDbType: 'VARCHAR',
    }));

    await store.dropTable(targetTable);
    await store.createTable(targetTable, outputColumns);

    const rows = await store.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdent(sourceTable)}`,
    );

    const outputBatch: Record<string, unknown>[] = [];
    const outputDateFormat = config.target.dateFormat;
    let rowsFailed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      try {
        const outRow: Record<string, unknown> = {};
        for (const field of config.transform.fields) {
          outRow[field.to] = applyFieldMapping(
            field,
            row,
            lookups,
            expressionEval,
            this.transforms,
            outputDateFormat,
          );
        }
        outputBatch.push(outRow);

        if (outputBatch.length >= config.run.batchSize) {
          await store.insertBatch(targetTable, outputBatch);
          outputBatch.length = 0;
        }
      } catch (err) {
        rowsFailed++;
        if (config.run.onError === 'stop') {
          throw err instanceof TransformError
            ? err
            : new TransformError(`transform failed at row ${i}: ${String(err)}`, err);
        }
        logger.warn(
          { rowIndex: i, err: err instanceof Error ? err.message : String(err) },
          'transform: row failed (onError: continue)',
        );
      }
    }
    if (outputBatch.length > 0) {
      await store.insertBatch(targetTable, outputBatch);
    }

    const rowsOut = await store.rowCount(targetTable);
    return { rowsIn: rows.length, rowsOut, rowsFailed };
  }
}

function applyFieldMapping(
  field: FieldMapping,
  row: Record<string, unknown>,
  lookups: LookupResolver,
  expr: ExpressionEvaluator,
  transforms: TransformRegistry,
  outputDateFormat: string | undefined,
): unknown {
  // ── Types that do not read `from` directly ──────────────────────────────
  if (field.type === 'constant') {
    return field.value ?? null;
  }
  if (field.type === 'expression') {
    if (typeof field.value !== 'string') {
      throw new TransformError(`expression field "${field.to}" requires string 'value'`);
    }
    return expr.evaluate(field.value, row);
  }
  if (field.type === 'custom') {
    if (!field.customOp) {
      throw new TransformError(`custom field "${field.to}" requires 'customOp'`);
    }
    const plugin: TransformPlugin | undefined = transforms.get(field.customOp);
    if (!plugin) {
      throw new TransformError(`No custom transform plugin registered for "${field.customOp}"`);
    }
    let value = typeof field.from === 'string' ? row[field.from] : undefined;

    // Apply default/optional logic before calling plugin
    if (value === null || value === undefined || value === '') {
      if (field.default !== undefined && field.default !== null) {
        return field.default;
      } else if (field.optional) {
        return null;
      }
    }

    const result = plugin.apply(value, row, field as unknown as CustomFieldMapping);

    // Apply default/optional logic after plugin returns
    if (result === null || result === undefined) {
      if (field.default !== undefined && field.default !== null) {
        return field.default;
      } else if (field.optional) {
        return null;
      }
    }

    return result;
  }

  // ── concat: join from[] with separator, then cleanse ────────────────────
  if (field.type === 'concat') {
    if (!Array.isArray(field.from)) {
      throw new TransformError(`concat field "${field.to}" requires array 'from'`);
    }
    const sep = field.separator ?? ' ';
    const parts = field.from.map((f) => {
      const v = row[f];
      return v === null || v === undefined ? '' : String(v);
    });
    let value: unknown = parts.join(sep);
    if (field.cleanse) value = applyCleanse(value, field.cleanse);
    if (value === null || value === undefined || value === '') {
      return applyDefaultOrOptional(field, value);
    }
    return String(value);
  }

  // ── lookup: resolve via LookupResolver ──────────────────────────────────
  if (field.type === 'lookup') {
    if (typeof field.from !== 'string') {
      throw new TransformError(`lookup field "${field.to}" requires string 'from'`);
    }
    if (!field.lookup) {
      throw new TransformError(`lookup field "${field.to}" requires 'lookup'`);
    }
    const sourceValue = row[field.from];
    const resolved = lookups.resolve(field.lookup, sourceValue);
    if (resolved !== undefined) return resolved;
    if (field.default !== undefined && field.default !== null) return field.default;
    if (field.optional) return null;
    throw new TransformError(
      `lookup "${field.lookup}" missed value "${String(sourceValue)}" for field "${field.to}"`,
    );
  }

  // ── Scalar types: string, number, decimal, boolean, date ─────────────────
  if (typeof field.from !== 'string') {
    throw new TransformError(
      `field "${field.to}" of type ${field.type} requires string 'from'`,
    );
  }

  let value: unknown = row[field.from];

  // Default + optional: null/empty handling
  if (value === null || value === undefined || value === '') {
    if (field.default !== undefined && field.default !== null) {
      value = field.default;
    } else if (field.optional) {
      return null;
    } else if (field.type === 'string') {
      // Empty strings pass through as-is for strings unless optional/default
      value = value === null || value === undefined ? null : '';
    }
  }

  if (field.cleanse && value !== null && value !== undefined) {
    value = applyCleanse(value, field.cleanse);
  }

  if (value === null || value === undefined) return null;

  switch (field.type) {
    case 'string': {
      let s = String(value);
      if (typeof field.max === 'number') s = s.slice(0, field.max);
      return s;
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new TransformError(`field "${field.to}" value "${String(value)}" is not a number`);
      }
      return Math.round(n);
    }
    case 'decimal': {
      const n = parseFloat(String(value));
      if (!Number.isFinite(n)) {
        throw new TransformError(
          `field "${field.to}" value "${String(value)}" is not a decimal`,
        );
      }
      return n.toFixed(field.precision ?? 2);
    }
    case 'boolean': {
      return ['1', 'true', 'yes', 'y', 't'].includes(String(value).toLowerCase())
        ? 'true'
        : 'false';
    }
    case 'date': {
      const parsed = field.format
        ? dayjs(String(value), field.format, true)
        : dayjs(String(value));
      if (!parsed.isValid()) {
        throw new TransformError(
          `field "${field.to}" value "${String(value)}" is not a valid date (format: ${field.format ?? 'ISO'})`,
        );
      }
      return outputDateFormat ? parsed.format(outputDateFormat) : parsed.toISOString();
    }
  }
  // Unreachable — all cases covered above
  return value;
}

function applyDefaultOrOptional(field: FieldMapping, value: unknown): unknown {
  if (field.default !== undefined && field.default !== null) return field.default;
  if (field.optional) return null;
  return value;
}
