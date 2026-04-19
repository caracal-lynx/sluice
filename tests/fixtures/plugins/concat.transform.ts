/**
 * Fixture transform plugin for testing row access and options.
 * Concatenates current field value with a field from the row, with optional prefix.
 * Requires options.prefix: string (optional).
 */

import type { CustomFieldMapping, TransformPlugin } from '../../../src/plugins/types.js';

export const transform: TransformPlugin = {
  id: 'testConcatWithRow',
  description: 'Fixture: concatenate field value with another row field',
  apply(
    value: unknown,
    row: Record<string, unknown>,
    config: CustomFieldMapping,
  ): unknown {
    if (value === null || value === undefined) return null;
    const otherField = (config.options?.['otherField'] as string | undefined) ?? 'id';
    const otherValue = row[otherField];
    if (otherValue === null || otherValue === undefined) return String(value);
    const prefix = (config.options?.['prefix'] as string | undefined) ?? '';
    return `${prefix}${String(value)}_${String(otherValue)}`;
  },
};
