/**
 * Template: Sluice Transform Plugin
 *
 * Copy this file to your plugins/ directory and fill in:
 * 1. Change the filename to match your operation: my-transform.transform.ts
 * 2. Update the id field below
 * 3. Implement your transformation logic in the apply() function
 *
 * Example usage in pipeline.yaml:
 *   transform:
 *     fields:
 *       - from: SourceField
 *         to: TargetField
 *         type: custom
 *         customOp: my-transform
 *         options:
 *           maxLength: 100
 *           lowercase: true
 */

import type { TransformPlugin } from "../../../src/plugins/types.js";

export const transform: TransformPlugin = {
  // ⚠️  REQUIRED: Unique identifier for your operation
  // Used in transform config as: customOp: my-transform
  id: "my-transform",

  /**
   * Transform a value.
   *
   * @param value - The field value to transform (may be null/undefined)
   * @param options - Arbitrary configuration options passed from pipeline YAML
   * @returns Transformed value (string), or null if transformation produces no result
   * @throws Error if transformation cannot proceed (pipeline will halt or continue per run.onError)
   */
  apply: async (value: unknown, options?: Record<string, unknown>): Promise<unknown> => {
    // Step 1: Handle null/undefined values
    if (value === null || value === undefined) {
      return null;
    }

    // Step 2: Extract and validate options (with sensible defaults)
    const maxLength = (options?.maxLength as number) ?? 100;
    const lowercase = (options?.lowercase as boolean) ?? true;

    // Step 3: Implement your transformation logic
    let result = String(value).trim();

    // Example: convert to lowercase if requested
    if (lowercase) {
      result = result.toLowerCase();
    }

    // Example: truncate to maxLength
    if (maxLength > 0 && result.length > maxLength) {
      result = result.substring(0, maxLength);
    }

    // Step 4: Return the result (or null if empty)
    return result === "" ? null : result;
  },
};
