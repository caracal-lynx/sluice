/**
 * Fixed decimal formatter — formats numeric values with fixed decimal places.
 * Common for financial data: price, cost, tax, etc.
 *
 * ID: fixed-decimal
 * Options:
 *   - places: number of decimal places (default: 2)
 *   - roundMode: 'round' | 'truncate' | 'ceil' (default: 'round')
 *   - padZeros: pad with zeros if fewer decimals (default: true)
 */

import type { TransformPlugin } from "../../../src/plugins/types.js";

export const transform: TransformPlugin = {
  id: "fixed-decimal",
  apply: async (value, options) => {
    if (value === null || value === undefined) return null;

    const places = (options?.places as number) ?? 2;
    const roundMode = (options?.roundMode as string) ?? "round";
    const padZeros = (options?.padZeros as boolean) ?? true;

    let num = Number(value);
    if (isNaN(num)) {
      throw new Error(`fixed-decimal: "${String(value)}" cannot be converted to a number`);
    }

    // Apply rounding mode
    const multiplier = Math.pow(10, places);
    switch (roundMode) {
      case "round":
        num = Math.round(num * multiplier) / multiplier;
        break;
      case "truncate":
        num = Math.trunc(num * multiplier) / multiplier;
        break;
      case "ceil":
        num = Math.ceil(num * multiplier) / multiplier;
        break;
      default:
        throw new Error(`fixed-decimal: unknown roundMode "${roundMode}"`);
    }

    // Format to fixed decimals
    return padZeros ? num.toFixed(places) : String(num);
  },
};
