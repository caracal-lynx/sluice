/**
 * Fixture transform plugin for loader tests.
 * Doubles a numeric value and returns it as a string.
 */

import type { CustomFieldMapping, TransformPlugin } from '../../../src/plugins/types.js';

export const transform: TransformPlugin = {
  id: 'testDouble',
  description: 'Fixture: double a numeric value',
  apply(
    value: unknown,
    _row: Record<string, unknown>,
    _config: CustomFieldMapping,
  ): unknown {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (isNaN(n)) return null;
    return String(n * 2);
  },
};
