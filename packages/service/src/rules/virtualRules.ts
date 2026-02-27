/**
 * @module rules/virtualRules
 * In-memory virtual rule store for externally registered inference rules.
 *
 * Virtual rules are registered at runtime by external consumers (e.g., OpenClaw plugins)
 * and merge into the inference pipeline alongside config-file rules.
 * They survive config reloads but NOT service restarts.
 */

import type { InferenceRule } from '../config/types';
import type { CompiledRule } from './compile';
import { compileRules } from './compile';

/** A set of virtual rules registered by a single source. */
interface VirtualRuleEntry {
  source: string;
  rules: InferenceRule[];
  compiled: CompiledRule[];
}

/**
 * In-memory store for virtual inference rules.
 *
 * Virtual rules are appended AFTER config-file rules in evaluation order.
 * Since inference uses last-match-wins for overlapping fields,
 * virtual rules take precedence over config rules when both match the same file.
 */
export class VirtualRuleStore {
  private readonly entries = new Map<string, VirtualRuleEntry>();

  /**
   * Register virtual rules from an external source.
   * Idempotent: re-registering with the same source replaces previous rules.
   *
   * @param source - Unique identifier for the rule source.
   * @param rules - Inference rule definitions to register.
   */
  register(source: string, rules: InferenceRule[]): void {
    const compiled = compileRules(rules);
    this.entries.set(source, { source, rules, compiled });
  }

  /**
   * Remove virtual rules by source.
   *
   * @param source - The source identifier to unregister.
   * @returns true if rules were found and removed.
   */
  unregister(source: string): boolean {
    return this.entries.delete(source);
  }

  /**
   * Get all compiled virtual rules in registration order.
   */
  getCompiled(): CompiledRule[] {
    const result: CompiledRule[] = [];
    for (const entry of this.entries.values()) {
      result.push(...entry.compiled);
    }
    return result;
  }

  /**
   * Get all raw virtual rule definitions grouped by source.
   * Used by the merged virtual document.
   */
  getAll(): Record<string, InferenceRule[]> {
    const result: Record<string, InferenceRule[]> = {};
    for (const [source, entry] of this.entries) {
      result[source] = entry.rules;
    }
    return result;
  }

  /** Check if any virtual rules are registered. */
  get isEmpty(): boolean {
    return this.entries.size === 0;
  }

  /** Total number of virtual rules across all sources. */
  get size(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      count += entry.rules.length;
    }
    return count;
  }
}
