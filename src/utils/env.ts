import { config as dotenvConfig } from 'dotenv';
import { ConfigError } from './errors.js';

let envLoaded = false;

export function loadEnv(envFile?: string): void {
  if (envLoaded) return;
  if (envFile !== undefined) {
    dotenvConfig({ path: envFile });
  } else {
    dotenvConfig();
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
