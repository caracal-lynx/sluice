/**
 * Fixture: malformed rule plugin — missing required 'rule' export.
 * Named malformed.ts (not .rule.ts) so the scanner doesn't auto-discover it.
 * The loader test copies it as 'malformed.rule.ts' into a temp directory.
 */

// Intentionally does NOT export 'rule'
export const notAPlugin = { description: "This file is missing the rule export" };
