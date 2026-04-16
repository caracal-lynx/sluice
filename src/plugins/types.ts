/**
 * Sluice — plugin interfaces
 * @caracal-lynx/sluice
 *
 * Interfaces for Tier 2 (file plugins) and Tier 3 (npm package plugins).
 * Plugins must be pure — no I/O, no side effects, no async.
 */

import type { CheckConfig } from '@/config/types.js';
import type { RuleRegistry, TransformRegistry } from './registry.js';

// ── DQ rule plugin ────────────────────────────────────────────────────────────

export interface RulePlugin {
  /** Must match the 'type' key used in pipeline YAML checks. */
  readonly id: string;

  /** Optional human-readable description for error messages and profiling. */
  readonly description?: string;

  /**
   * Validate a single cell value.
   * Return null if valid; RuleViolation if not.
   * Must be pure — no side effects, no I/O.
   */
  validate(
    value: unknown,
    config: CheckConfig,
    rowIndex: number,
    field: string,
  ): RuleViolation | null;
}

export interface RuleViolation {
  field:    string;
  rowIndex: number;
  value:    unknown;
  rule:     string;
  severity: 'critical' | 'warning' | 'info';
  message:  string;
}

// ── Transform plugin ──────────────────────────────────────────────────────────

export interface TransformPlugin {
  /**
   * Must match the 'customOp' key used in pipeline YAML field mappings.
   * Used with: type: custom, customOp: <id>
   */
  readonly id: string;
  readonly description?: string;

  /**
   * Transform a single source value.
   * Receives the raw value and the full source row for cross-field operations.
   * Return the transformed value. Return null to emit a null in the output.
   * Throw TransformError for unrecoverable errors.
   * Must be pure — no side effects, no I/O.
   * Must not mutate the row object.
   */
  apply(
    value: unknown,
    row: Record<string, unknown>,
    config: CustomFieldMapping,
  ): unknown;
}

export interface CustomFieldMapping {
  from?:    string | string[];
  to:       string;
  type:     'custom';
  customOp: string;
  /** Arbitrary per-plugin config from YAML, passed through verbatim. */
  options?: Record<string, unknown>;
  default?: unknown;
  optional?: boolean;
}

// ── Registration function (Tier 3 npm packages) ───────────────────────────────

export interface PluginPackage {
  register(
    rules:      RuleRegistry,
    transforms: TransformRegistry,
    options?:   Record<string, unknown>,
  ): void;
}
