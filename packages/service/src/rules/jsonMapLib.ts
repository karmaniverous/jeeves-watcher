/**
 * @module rules/jsonMapLib
 * Creates the lib object for JsonMap transformations.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

import { get } from 'radash';

/**
 * Create the lib object for JsonMap transformations.
 *
 * @param configDir - Optional config directory for resolving relative file paths in lookups.
 * @param customLib - Optional custom lib functions to merge.
 * @param extractText - Optional callback to extract text from a file path. Returns extracted text or undefined on failure.
 * @returns The lib object.
 */
export function createJsonMapLib(
  configDir?: string,
  customLib?: Record<string, (...args: unknown[]) => unknown>,
  extractText?: (filePath: string) => string | undefined,
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

    /**
     * Retrieve extracted text from neighboring files in the same directory.
     *
     * @param filePath - The current file path.
     * @param options - Optional windowing and sort options.
     * @returns Flat array of extracted text from siblings, in sort order.
     */
    fetchSiblings: (
      filePath: string,
      options?: { before?: number; after?: number; sort?: 'name' | 'mtime' },
    ): string[] => {
      if (!extractText) return [];

      const { before = 3, after = 1, sort = 'name' } = options ?? {};
      const dir = dirname(filePath);
      const ext = extname(filePath);

      // List all files in the directory with the same extension
      let entries: string[];
      try {
        entries = readdirSync(dir).filter((name) => extname(name) === ext);
      } catch {
        return [];
      }

      // Sort by filename (default) or mtime
      if (sort === 'mtime') {
        entries.sort((a, b) => {
          try {
            const aStat = statSync(join(dir, a));
            const bStat = statSync(join(dir, b));
            return aStat.mtimeMs - bStat.mtimeMs;
          } catch {
            return 0;
          }
        });
      } else {
        entries.sort();
      }

      // Find current file's position
      const currentName = filePath.split(/[\\/]/).pop()!;
      const currentIndex = entries.indexOf(currentName);
      if (currentIndex === -1) return [];

      // Slice before/after window (excluding current file)
      const beforeEntries = entries.slice(
        Math.max(0, currentIndex - before),
        currentIndex,
      );
      const afterEntries = entries.slice(
        currentIndex + 1,
        currentIndex + 1 + after,
      );
      const window = [...beforeEntries, ...afterEntries];

      // Extract text from each sibling, silently skipping failures
      const results: string[] = [];
      for (const name of window) {
        try {
          const text = extractText(join(dir, name));
          if (text !== undefined) results.push(text);
        } catch {
          // Silently skip files that fail extraction
        }
      }

      return results;
    },
    ...customLib,
  };
}
