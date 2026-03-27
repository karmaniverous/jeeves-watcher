/**
 * @module values/ValuesManager
 * Manages per-rule distinct metadata value tracking. Persists to disk with in-memory caching and sorted deduplication.
 */

import { join } from 'node:path';

import type pino from 'pino';

import { BinaryFileStore } from '../util/BinaryFileStore';

/** Per-rule distinct values: rule name → field name → sorted unique values. */
export type ValuesIndex = Record<string, Record<string, unknown[]>>;

/**
 * Manages a persistent values.json file tracking distinct metadata values per rule.
 */
export class ValuesManager extends BinaryFileStore<ValuesIndex> {
  constructor(stateDir: string, logger: pino.Logger) {
    super({ filePath: join(stateDir, 'values.v8'), logger });
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

    let changed = false;

    for (const [key, value] of Object.entries(metadata)) {
      // Decompose arrays into individual trackable elements so that
      // array-typed fields (e.g. domains: ["email"]) are indexed.
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (!this.isTrackable(item)) continue;
        ruleValues[key] ??= [];
        const arr = ruleValues[key];
        if (!arr.includes(item)) {
          arr.push(item);
          arr.sort((a, b) => {
            if (typeof a === typeof b) {
              return String(a).localeCompare(String(b));
            }
            return typeof a < typeof b ? -1 : 1;
          });
          changed = true;
        }
      }
    }

    if (changed) this.markDirty();
  }

  /** Wipe all values (called on full reindex start). */
  clearAll(): void {
    this.cache = {};
    this.markDirty();
    this.flush();
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
