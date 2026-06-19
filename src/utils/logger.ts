// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import pino from "pino";

/**
 * Route all pino output to stderr so stdout stays dedicated to the progress
 * bar rendered by `ProgressReporter`. This matches how tools like git, cargo,
 * and npm separate streams:
 *
 *   stdout  → progress feedback and final summary (from ProgressReporter)
 *   stderr  → all structured log records (info, warn, error, fatal)
 *
 * Operators who want just the logs in a file can use `2>run.log`; the bar
 * stays visible on the terminal.
 */
export const logger = pino(
  { level: process.env["LOG_LEVEL"] ?? "info" },
  pino.destination({ fd: 2, sync: false }),
);
