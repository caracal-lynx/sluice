/**
 * Fixture transform plugin for testing options pass-through.
 * Applies a margin percentage to a numeric value.
 * Requires options.margin: number (e.g., 65 for 65% margin).
 */

import type { CustomFieldMapping, TransformPlugin } from '../../../src/plugins/types.js';

export const transform: TransformPlugin = {
  id: 'testPriceWithMargin',
  description: 'Fixture: apply margin percentage to a price',
  apply(
    value: unknown,
    _row: Record<string, unknown>,
    config: CustomFieldMapping,
  ): unknown {
    if (value === null || value === undefined || value === '') return null;
    const margin = (config.options?.['margin'] as number | undefined) ?? 0;
    const basePrice = Number(value);
    if (isNaN(basePrice)) return null;
    const withMargin = basePrice * (1 + margin / 100);
    return withMargin.toFixed(2);
  },
};
