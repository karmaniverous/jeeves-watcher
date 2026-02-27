/**
 * @module rules/jsonMapLib
 * Creates the lib object for JsonMap transformations.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { get } from 'radash';

/**
 * Create the lib object for JsonMap transformations.
 *
 * @param configDir - Optional config directory for resolving relative file paths in lookups.
 * @param customLib - Optional custom lib functions to merge.
 * @returns The lib object.
 */
export function createJsonMapLib(
  configDir?: string,
  customLib?: Record<string, (...args: unknown[]) => unknown>,
) {
  // Cache loaded JSON files within a single applyRules invocation.
  const jsonCache = new Map<string, unknown>();

  const loadJson = (filePath: string): Record<string, unknown> => {
    const resolvedPath = configDir ? resolve(configDir, filePath) : filePath;
    if (!jsonCache.has(resolvedPath)) {
      const raw = readFileSync(resolvedPath, 'utf-8');
      jsonCache.set(resolvedPath, JSON.parse(raw) as unknown);
    }
    return jsonCache.get(resolvedPath) as Record<string, unknown>;
  };

  return {
    split: (str: string, separator: string) => str.split(separator),
    slice: <T>(arr: T[], start: number, end?: number) => arr.slice(start, end),
    join: (arr: string[], separator: string) => arr.join(separator),
    toLowerCase: (str: string) => str.toLowerCase(),
    replace: (str: string, search: string | RegExp, replacement: string) =>
      str.replace(search, replacement),
    get: (obj: unknown, path: string) => get(obj, path),

    /**
     * Load a JSON file (relative to configDir) and look up a value by key,
     * optionally drilling into a sub-path.
     *
     * @param filePath - Path to a JSON file (resolved relative to configDir).
     * @param key - Top-level key to look up.
     * @param field - Optional dot-path into the looked-up entry.
     * @returns The resolved value, or null if not found.
     */
    lookupJson: (filePath: string, key: string, field?: string) => {
      const data = loadJson(filePath);
      const entry = data[key];
      if (entry === undefined || entry === null) return null;
      if (field) return get(entry, field) ?? null;
      return entry;
    },

    /**
     * Map an array of keys through a JSON lookup file, collecting a specific
     * field from each matching entry. Non-matching keys are silently skipped.
     * Array-valued fields are flattened into the result.
     *
     * @param filePath - Path to a JSON file (resolved relative to configDir).
     * @param keys - Array of top-level keys to look up.
     * @param field - Dot-path into each looked-up entry.
     * @returns Flat array of resolved values.
     */
    mapLookup: (filePath: string, keys: unknown[], field: string) => {
      if (!Array.isArray(keys)) return [];
      const data = loadJson(filePath);
      const results: unknown[] = [];
      for (const k of keys) {
        if (typeof k !== 'string') continue;
        const entry = data[k];
        if (entry === undefined || entry === null) continue;
        const val = get(entry, field);
        if (val === undefined || val === null) continue;
        if (Array.isArray(val)) {
          for (const item of val) {
            results.push(item);
          }
        } else {
          results.push(val);
        }
      }
      return results;
    },
    ...customLib,
  };
}
