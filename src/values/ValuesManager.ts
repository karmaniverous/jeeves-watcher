/**
 * @module values/ValuesManager
 * Manages per-rule distinct metadata value tracking. Persists to disk with in-memory caching and sorted deduplication.
 */

import { join } from 'node:path';

import type pino from 'pino';

import { JsonFileStore } from '../util/JsonFileStore';

/** Per-rule distinct values: rule name → field name → sorted unique values. */
export type ValuesIndex = Record<string, Record<string, unknown[]>>;

/**
 * Manages a persistent values.json file tracking distinct metadata values per rule.
 */
export class ValuesManager extends JsonFileStore<ValuesIndex> {
  constructor(stateDir: string, logger: pino.Logger) {
    super({ filePath: join(stateDir, 'values.json'), logger });
  }

  protected createEmpty(): ValuesIndex {
    return {};
  }

  /** Check if a value is a trackable primitive (string, number, boolean). */
  private isTrackable(value: unknown): value is string | number | boolean {
    const t = typeof value;
    return t === 'string' || t === 'number' || t === 'boolean';
  }

  /** Update distinct values for a rule from metadata. */
  update(ruleName: string, metadata: Record<string, unknown>): void {
    const index = this.load();
    index[ruleName] ??= {};
    const ruleValues = index[ruleName];

    for (const [key, value] of Object.entries(metadata)) {
      if (!this.isTrackable(value)) continue;
      ruleValues[key] ??= [];
      const arr = ruleValues[key];
      if (!arr.includes(value)) {
        arr.push(value);
        arr.sort((a, b) => {
          if (typeof a === typeof b) {
            return String(a).localeCompare(String(b));
          }
          return typeof a < typeof b ? -1 : 1;
        });
      }
    }

    this.save();
  }

  /** Wipe all values (called on full reindex start). */
  clearAll(): void {
    this.cache = {};
    this.save();
    this.logger.debug('All values cleared');
  }

  /** Get all current values. */
  getAll(): ValuesIndex {
    return { ...this.load() };
  }

  /** Get values for a specific rule. */
  getForRule(ruleName: string): Record<string, unknown[]> {
    const index = this.load();
    return { ...index[ruleName] };
  }
}
