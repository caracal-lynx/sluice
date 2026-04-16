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
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(`Required environment variable not set: ${name}`);
  }
  return value;
}
