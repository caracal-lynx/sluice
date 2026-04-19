/**
 * BlueCherry (CGS) ERP target adapter.
 *
 * Validates that every REQUIRED_COLUMN for the target entity exists in
 * stg_transformed, then writes a CSV honouring:
 *   - default includeHeader: true
 *   - default dateFormat: MM/DD/YYYY
 *   - any column whose name ends with `Date` (case-insensitive) auto-formatted
 *   - nullValue for null/undefined cells
 *   - template: 'default' → REQUIRED_COLUMNS[entity] + any extra stg_transformed columns
 *   - template: '<path>'  → first line of the CSV file is the column order
 *
 * Per plan risk #5: the required-column check runs at the top of `load()`
 * (the `connect()` interface doesn't carry a StagingStore, so the check can't
 * live there without changing the interface).
 */

import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { stringify } from 'csv-stringify/sync';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

import type { RunConfig, TargetConfig } from '../../config/types.js';
import type { StagingStore } from '../../staging/index.js';
import { ConfigError, LoadError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { LoadResult, TargetAdapter } from './types.js';

dayjs.extend(customParseFormat);

const STAGING_TABLE = 'stg_transformed';

// These column names are internal conventions. Verify against actual
// BlueCherry import documentation before running a live migration.
const REQUIRED_COLUMNS: Readonly<Record<string, string[]>> = Object.freeze({
  Style: ['StyleNo', 'StyleDesc', 'Division', 'Season', 'CostPrice', 'RetailPrice', 'ActiveFlag'],
  Vendor: ['VendorNo', 'VendorName', 'Country', 'CurrencyCode'],
  PurchaseOrder: ['PONumber', 'VendorNo', 'Season', 'OrderDate', 'DeliveryDate'],
  PODetail: ['PONumber', 'StyleNo', 'ColourCode', 'SizeCode', 'Quantity', 'CostPrice'],
  Season: ['SeasonCode', 'SeasonDesc', 'StartDate', 'EndDate'],
  ColourSize: ['StyleNo', 'ColourCode', 'ColourDesc', 'SizeCode', 'SizeDesc'],
});

function isDateColumn(name: string): boolean {
  return name.toLowerCase().endsWith('date');
}

function reformatIfDate(colName: string, value: unknown, outputFormat: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isDateColumn(colName)) return String(value);
  const parsed = dayjs(String(value));
  if (!parsed.isValid()) return String(value);
  return parsed.format(outputFormat);
}

export class BlueCherryTargetAdapter implements TargetAdapter {
  readonly id = 'bluecherry';

  async connect(config: TargetConfig): Promise<void> {
    // Basic config sanity — the full column check needs access to the store,
    // so it runs inside load().
    if (!config.entity) {
      throw new ConfigError('bluecherry target requires `entity`');
    }
    if (!REQUIRED_COLUMNS[config.entity]) {
      throw new ConfigError(
        `bluecherry: unknown entity "${config.entity}". Known: ${Object.keys(REQUIRED_COLUMNS).join(', ')}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    // nothing to release
  }

  async load(
    config: TargetConfig,
    store: StagingStore,
    _runConfig: RunConfig,
    onProgress: (rows: number) => void,
  ): Promise<LoadResult> {
    if (!config.output) {
      throw new LoadError('bluecherry target requires `output`');
    }
    if (!config.entity) {
      throw new ConfigError('bluecherry target requires `entity`');
    }

    const required = REQUIRED_COLUMNS[config.entity];
    if (!required) {
      throw new ConfigError(`bluecherry: unknown entity "${config.entity}"`);
    }

    const staged = await store.columnNames(STAGING_TABLE);
    const missing = required.filter((c) => !staged.includes(c));
    if (missing.length > 0) {
      throw new ConfigError(
        `bluecherry: stg_transformed is missing required columns for entity "${config.entity}": ${missing.join(', ')}`,
      );
    }

    // Resolve column order from `template`
    let columnOrder: string[];
    if (config.template === 'default' || config.template === undefined) {
      const extras = staged.filter((c) => !required.includes(c));
      columnOrder = [...required, ...extras];
    } else {
      try {
        const firstLine = readFileSync(config.template, 'utf-8').split(/\r?\n/)[0] ?? '';
        columnOrder = firstLine
          .split(config.delimiter ?? ',')
          .map((c) => c.trim())
          .filter(Boolean);
      } catch (err) {
        throw new ConfigError(
          `bluecherry: failed to read template "${config.template}": ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
      const templateMissing = required.filter((c) => !columnOrder.includes(c));
      if (templateMissing.length > 0) {
        throw new ConfigError(
          `bluecherry: template is missing required columns: ${templateMissing.join(', ')}`,
        );
      }
    }

    const outputPath = path.resolve(config.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const dateFormat = config.dateFormat ?? 'MM/DD/YYYY';
    const nullValue = config.nullValue;
    const includeHeader = config.includeHeader ?? true;

    const rows = await store.query<Record<string, unknown>>(`SELECT * FROM "${STAGING_TABLE}"`);
    const csvRows: string[][] = [];
    if (includeHeader) csvRows.push(columnOrder);
    for (const row of rows) {
      csvRows.push(
        columnOrder.map((col) => {
          const formatted = reformatIfDate(col, row[col], dateFormat);
          return formatted === null ? nullValue : formatted;
        }),
      );
    }

    const csv = stringify(csvRows, { delimiter: config.delimiter ?? ',' });
    await fs.writeFile(outputPath, csv, 'utf-8');

    onProgress(rows.length);
    logger.debug(
      { outputPath, rowsLoaded: rows.length, entity: config.entity, columns: columnOrder.length },
      'bluecherry target: load complete',
    );

    return { rowsLoaded: rows.length, rowsFailed: 0, outputPath };
  }
}
