// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Built-in DQ rules share the same interface as user-registered RulePlugins.
 * Keeping the shapes aligned means the engine can look up rules uniformly.
 */

export type { RulePlugin as Rule, RuleViolation } from '../../plugins/types.js';
