/**
 * Sluice — plugin registries
 * @caracal-lynx/sluice
 *
 * RuleRegistry and TransformRegistry hold custom plugins loaded from
 * file plugins (Tier 2) and npm packages (Tier 3). Built-in rules and
 * transform types are NOT stored here — the DQ and transform engines
 * consult built-ins first, then fall through to the registry.
 */

import type { RulePlugin, TransformPlugin } from './types.js';
import { ConfigError } from '../utils/errors.js';

export class RuleRegistry {
  private readonly plugins = new Map<string, RulePlugin>();

  register(plugin: RulePlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new ConfigError(
        `Duplicate rule plugin id "${plugin.id}". ` +
        `Check plugins/ folder and npm plugin packages for conflicts.`,
      );
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): RulePlugin | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  list(): string[] {
    return [...this.plugins.keys()];
  }
}

export class TransformRegistry {
  private readonly plugins = new Map<string, TransformPlugin>();

  register(plugin: TransformPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new ConfigError(
        `Duplicate transform plugin id "${plugin.id}". ` +
        `Check plugins/ folder and npm plugin packages for conflicts.`,
      );
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): TransformPlugin | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  list(): string[] {
    return [...this.plugins.keys()];
  }
}
