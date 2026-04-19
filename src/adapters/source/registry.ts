/**
 * Global registry of source adapters, keyed by adapter id ('csv', 'mssql', ...).
 *
 * Built-in adapters self-register when the `adapters/source` barrel is
 * imported. Tests that need a clean registry can call `unregister()`.
 */

import { ConfigError } from '../../utils/errors.js';
import type { SourceAdapter } from './types.js';

const adapters = new Map<string, SourceAdapter>();

export class SourceAdapterRegistry {
  static register(adapter: SourceAdapter): void {
    if (adapters.has(adapter.id)) {
      throw new ConfigError(`Duplicate source adapter id "${adapter.id}"`);
    }
    adapters.set(adapter.id, adapter);
  }

  static get(id: string): SourceAdapter {
    const adapter = adapters.get(id);
    if (!adapter) {
      throw new ConfigError(
        `No source adapter registered for "${id}". Known adapters: ${[...adapters.keys()].join(', ') || '(none)'}`,
      );
    }
    return adapter;
  }

  static has(id: string): boolean {
    return adapters.has(id);
  }

  static list(): string[] {
    return [...adapters.keys()];
  }

  /** Remove an adapter by id. Primarily for test isolation. */
  static unregister(id: string): void {
    adapters.delete(id);
  }
}
