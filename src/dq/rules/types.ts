/**
 * Built-in DQ rules share the same interface as user-registered RulePlugins.
 * Keeping the shapes aligned means the engine can look up rules uniformly.
 */

export type { RulePlugin as Rule, RuleViolation } from '../../plugins/types.js';
