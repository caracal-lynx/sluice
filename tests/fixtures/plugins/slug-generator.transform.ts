/**
 * Example transform plugin — converts a string to a URL-safe slug.
 *
 * ID: slug-generator
 * Usage in transform config:
 *   - from: ProductName
 *     to: ProductSlug
 *     type: custom
 *     customOp: slug-generator
 *     options:
 *       separator: "-"
 *       lowercase: true
 */

import type { TransformPlugin } from '../../../src/plugins/types.js';

export const transform: TransformPlugin = {
  id: 'slug-generator',
  apply: async (value: unknown, options?: Record<string, unknown>): Promise<unknown> => {
    if (value === null || value === undefined) return null;

    const str = String(value).trim();
    if (str === '') return null;

    const separator = (options?.separator as string) ?? '-';
    const lowercase = (options?.lowercase as boolean) ?? true;

    // Convert to lowercase if requested
    let slug = lowercase ? str.toLowerCase() : str;

    // Replace spaces and underscores with separator
    slug = slug.replace(/[\s_]+/g, separator);

    // Remove non-alphanumeric characters (except separator and hyphens)
    slug = slug.replace(new RegExp(`[^a-z0-9${separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`, 'g'), '');

    // Remove leading/trailing separators
    slug = slug.replace(new RegExp(`^${separator}+|${separator}+$`, 'g'), '');

    // Collapse multiple consecutive separators
    slug = slug.replace(new RegExp(`${separator}{2,}`, 'g'), separator);

    return slug || null;
  },
};
