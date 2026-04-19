import { ConfigError } from '../../utils/errors.js';
import type { TargetAdapter } from './types.js';

const adapters = new Map<string, TargetAdapter>();

export class TargetAdapterRegistry {
  static register(adapter: TargetAdapter): void {
    if (adapters.has(adapter.id)) {
      throw new ConfigError(`Duplicate target adapter id "${adapter.id}"`);
    }
    adapters.set(adapter.id, adapter);
  }

  static get(id: string): TargetAdapter {
    const adapter = adapters.get(id);
    if (!adapter) {
      throw new ConfigError(
        `No target adapter registered for "${id}". Known adapters: ${[...adapters.keys()].join(', ') || '(none)'}`,
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

  static unregister(id: string): void {
    adapters.delete(id);
  }
}
