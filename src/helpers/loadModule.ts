/**
 * @module helpers/loadModule
 * Shared utility for loading and namespace-prefixing exports from helper modules.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Load modules from named helper config and return their exports grouped by namespace.
 *
 * Each module is dynamically imported. If it has a `default` export that is an object,
 * that object's entries are used; otherwise named exports are used.
 * An optional filter selects which exports to include.
 *
 * @param helpers - Named helper config: Record of namespace to path/description.
 * @param configDir - Directory to resolve relative paths against.
 * @param filter - Optional predicate to filter export values (e.g. only functions).
 * @returns Record of namespace to Record of exportName to value.
 */
export async function loadNamespacedExports(
  helpers: Record<string, { path: string }>,
  configDir: string,
  filter?: (value: unknown) => boolean,
): Promise<Record<string, Record<string, unknown>>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [namespace, { path: p }] of Object.entries(helpers)) {
    const resolved = resolve(configDir, p);
    const mod = (await import(pathToFileURL(resolved).href)) as Record<
      string,
      unknown
    >;
    const entries =
      typeof mod.default === 'object' && mod.default !== null
        ? (mod.default as Record<string, unknown>)
        : mod;

    const nsExports: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(entries)) {
      if (!filter || filter(val)) {
        nsExports[key] = val;
      }
    }
    result[namespace] = nsExports;
  }

  return result;
}
