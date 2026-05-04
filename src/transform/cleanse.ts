// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Ltd.

/**
 * Cleanse operations — pure string functions applied left-to-right through
 * the pipe-separated `cleanse:` value on a field mapping.
 *
 * Each op is referenced by name in CLAUDE.md's cleanse operations table. Do
 * NOT add new ops without updating that table.
 */

import { TransformError } from '../utils/errors.js';

type CleanseOp = (value: string) => string | null;

const OPS: Record<string, CleanseOp> = {
  trim: (v) => v.trim(),
  uppercase: (v) => v.toUpperCase(),
  lowercase: (v) => v.toLowerCase(),
  titleCase: (v) =>
    v.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
  stripNonAlpha: (v) => v.replace(/[^a-zA-Z]/g, ''),
  stripNonNumeric: (v) => v.replace(/[^0-9]/g, ''),
  stripWhitespace: (v) => v.replace(/\s+/g, ''),
  nullIfEmpty: (v) => (v === '' ? null : v),
  normaliseQuotes: (v) =>
    v.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"'),
  // NFD → strip combining marks → leave ASCII text
  normaliseUnicode: (v) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
};

export function applyCleanse(value: unknown, spec: string): unknown {
  if (value === null || value === undefined) return value;
  let current: string | null = String(value);

  for (const step of spec.split('|')) {
    if (current === null) return null;
    const [name, ...args] = step.split(':');
    if (!name) continue;

    if (name === 'padStart') {
      const width = Number.parseInt(args[0] ?? '0', 10);
      const pad = args[1] ?? ' ';
      if (!Number.isFinite(width) || width < 0) {
        throw new TransformError(`padStart requires a non-negative width, got "${args[0]}"`);
      }
      current = current.padStart(width, pad);
      continue;
    }
    if (name === 'truncate') {
      const len = Number.parseInt(args[0] ?? '0', 10);
      if (!Number.isFinite(len) || len < 0) {
        throw new TransformError(`truncate requires a non-negative length, got "${args[0]}"`);
      }
      current = current.slice(0, len);
      continue;
    }

    const op = OPS[name];
    if (!op) {
      throw new TransformError(`Unknown cleanse operation: "${name}"`);
    }
    current = op(current);
  }
  return current;
}
