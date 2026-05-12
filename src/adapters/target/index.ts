// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import { BcTargetAdapter } from './bc.js';
import { BlueCherryTargetAdapter } from './bluecherry.js';
import { CsvTargetAdapter } from './csv.js';
import { IfsTargetAdapter } from './ifs.js';
import { PgTargetAdapter } from './pg.js';
import { TargetAdapterRegistry } from './registry.js';

if (!TargetAdapterRegistry.has('csv')) {
  TargetAdapterRegistry.register(new CsvTargetAdapter());
  TargetAdapterRegistry.register(new IfsTargetAdapter());
  TargetAdapterRegistry.register(new BlueCherryTargetAdapter());
  TargetAdapterRegistry.register(new PgTargetAdapter());
  TargetAdapterRegistry.register(new BcTargetAdapter());
}

export { BcTargetAdapter, BcTokenManager } from './bc.js';
export { BlueCherryTargetAdapter } from './bluecherry.js';
export { CsvTargetAdapter } from './csv.js';
export { IfsTargetAdapter } from './ifs.js';
export { PgTargetAdapter } from './pg.js';
export { TargetAdapterRegistry } from './registry.js';
export type { LoadResult, TargetAdapter } from './types.js';
