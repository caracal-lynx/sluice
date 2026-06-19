// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Barrel for source adapters. Built-in adapters self-register on first import.
 */

import { CsvSourceAdapter } from "./csv.js";
import { MssqlSourceAdapter } from "./mssql.js";
import { OdooCsvSourceAdapter } from "./odoo-csv.js";
import { PgSourceAdapter } from "./pg.js";
import { RestSourceAdapter } from "./rest.js";
import { SourceAdapterRegistry } from "./registry.js";
import { XlsxSourceAdapter } from "./xlsx.js";

// Register built-in source adapters exactly once (ES modules are single-eval).
if (!SourceAdapterRegistry.has("csv")) {
  SourceAdapterRegistry.register(new CsvSourceAdapter());
  SourceAdapterRegistry.register(new MssqlSourceAdapter());
  SourceAdapterRegistry.register(new PgSourceAdapter());
  SourceAdapterRegistry.register(new XlsxSourceAdapter());
  SourceAdapterRegistry.register(new RestSourceAdapter());
  SourceAdapterRegistry.register(new OdooCsvSourceAdapter());
}

export { CsvSourceAdapter } from "./csv.js";
export { MssqlSourceAdapter } from "./mssql.js";
export { OdooCsvSourceAdapter } from "./odoo-csv.js";
export { PgSourceAdapter } from "./pg.js";
export { RestSourceAdapter } from "./rest.js";
export { SourceAdapterRegistry } from "./registry.js";
export { XlsxSourceAdapter } from "./xlsx.js";
export type { ExtractResult, SourceAdapter } from "./types.js";
export type { ColumnMeta } from "../../staging/index.js";
