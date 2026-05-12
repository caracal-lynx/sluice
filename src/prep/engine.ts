// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * PrepEngine — applies a list of PrepRule[] to a staging table in place.
 *
 * Stage 2 (this file's first commit) ships the class signature and a
 * not-yet-implemented run() body so callers can be wired up without
 * crashing the build. Stage 3 fleshes out the algorithm:
 *   1. Validate every rule's `field` exists in the target table.
 *   2. Filter rules by firing point (single-source / per-source / post-merge).
 *   3. Batched read → cleanse | expression | lookup | when → CREATE OR REPLACE.
 *
 * See docs/PHASE-12-prep-phase-spec.md → "Engine: PrepEngine" for the full spec.
 */

import type { PrepConfig, RunConfig } from '../config/types.js';
import type { StagingStore } from '../staging/index.js';
import type { ExpressionEvaluator } from '../transform/expression.js';
import type { Logger } from 'pino';
import { PrepError } from '../utils/errors.js';
import type { PrepFiringResult } from './types.js';
import type { PrepLookupResolver } from './lookup.js';

export class PrepEngine {
  constructor(
    private readonly store: StagingStore,
    private readonly resolver: PrepLookupResolver,
    private readonly evaluator: ExpressionEvaluator,
    private readonly logger: Logger,
  ) {}

  /**
   * Apply prep rules to a single staging table.
   *
   * @param table     Staging table name to mutate in place.
   * @param prep      Parsed PrepSchema config.
   * @param sourceId  For multi-source pre-merge firings, the current source id.
   *                  `undefined` for single-source runs and post-merge firings.
   * @param runCfg    Run config (batchSize, onError).
   */
  async run(
    _table: string,
    _prep: PrepConfig,
    _sourceId: string | undefined,
    _runCfg: RunConfig,
  ): Promise<PrepFiringResult> {
    throw new PrepError('PrepEngine.run() not yet implemented (Phase 12 Stage 3)');
  }
}
