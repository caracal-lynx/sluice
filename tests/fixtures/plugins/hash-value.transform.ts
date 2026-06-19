/**
 * Example transform plugin — creates a consistent hash from a value.
 *
 * ID: hash-value
 * Usage in transform config:
 *   - from: CustomerEmail
 *     to: AnonymizedId
 *     type: custom
 *     customOp: hash-value
 *     options:
 *       algorithm: "sha256"
 *       encoding: "hex"
 *       truncate: 16
 */

import { createHash } from "node:crypto";
import type { TransformPlugin } from "../../../src/plugins/types.js";

export const transform: TransformPlugin = {
  id: "hash-value",
  apply: async (value: unknown, options?: Record<string, unknown>): Promise<unknown> => {
    if (value === null || value === undefined) return null;

    const str = String(value).trim();
    if (str === "") return null;

    const algorithm = (options?.algorithm as string) ?? "sha256";
    const encoding = (options?.encoding as string) ?? "hex";
    const truncate = (options?.truncate as number) ?? 0;

    try {
      let hash = createHash(algorithm).update(str).digest(encoding);
      if (truncate > 0) {
        hash = hash.substring(0, truncate);
      }
      return hash;
    } catch (err) {
      throw new Error(`hash-value: ${String(err)}`);
    }
  },
};
