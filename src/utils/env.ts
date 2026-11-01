// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

import { config as dotenvConfig } from "dotenv";
import { ConfigError } from "./errors.js";

let envLoaded = false;

export function loadEnv(envFile?: string): void {
  if (envLoaded) return;
  // `quiet: true` stops dotenv printing its own "injected env (N) from <path>"
  // line on every call. dotenv 17 wrote it, with a random advert, to stdout,
  // where it broke `--silent`. dotenv 18 writes it to stderr, where it is the
  // one non-JSON line in pino's NDJSON log stream. Either way it is not ours
  // to print (DAG-362).
  if (envFile !== undefined) {
    dotenvConfig({ path: envFile, quiet: true });
  } else {
    dotenvConfig({ quiet: true });
  }
  envLoaded = true;
}

export function requireEnv(name: string): string {
  // Treat an explicitly-set empty string as set. "Not set" means the
  // variable is absent from the environment, not that it is empty.
  const value = process.env[name];
  if (value === undefined) {
    throw new ConfigError(`Required environment variable not set: ${name}`);
  }
  return value;
}
