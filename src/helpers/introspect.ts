/**
 * @module helpers/introspect
 * JSDoc introspection for helper modules. Extracts function exports and their descriptions.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Result of introspecting a single helper module. */
export interface HelperModuleIntrospection {
  /** Map of namespace_exportName to JSDoc description (empty string if none). */
  exports: Record<string, string>;
}

/** Result of introspecting all helper modules. */
export interface AllHelpersIntrospection {
  mapHelpers: Record<string, HelperModuleIntrospection>;
  templateHelpers: Record<string, HelperModuleIntrospection>;
}

/**
 * Extract JSDoc descriptions from source code for exported functions.
 *
 * Looks for JSDoc comments immediately before `export function name` or `export const name`.
 *
 * @param source - The source file content.
 * @returns Map of export name to JSDoc description.
 */
function extractJsDocDescriptions(source: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Match JSDoc comment followed by export function/const
  const pattern = /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:function|const)\s+(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const [, commentBody, name] = match;
    if (!name || !commentBody) continue;

    // Extract the description: lines before any @tag
    const lines = commentBody
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .filter((line) => line.length > 0 && !line.startsWith('@'));

    result[name] = lines.join(' ');
  }

  return result;
}

/**
 * Introspect a single helper module, enumerating function exports and extracting JSDoc descriptions.
 *
 * @param filePath - Resolved path to the helper module.
 * @param namespace - The namespace prefix for this module.
 * @returns Introspection result with namespaced export names and descriptions.
 */
export async function introspectHelperModule(
  filePath: string,
  namespace: string,
): Promise<HelperModuleIntrospection> {
  const exports: Record<string, string> = {};

  // Load the module to enumerate exports
  const mod = (await import(pathToFileURL(filePath).href)) as Record<
    string,
    unknown
  >;

  // Try to read source for JSDoc extraction
  let jsDocMap: Record<string, string> = {};
  // Try .ts source first, then fall back to .js
  for (const ext of ['.ts', '.js', '']) {
    const sourcePath = filePath.replace(/\.[jt]s$/, '') + ext;
    try {
      const source = readFileSync(ext === '' ? filePath : sourcePath, 'utf-8');
      jsDocMap = extractJsDocDescriptions(source);
      if (Object.keys(jsDocMap).length > 0) break;
    } catch {
      // File not found, try next
    }
  }

  // Enumerate function exports
  const fns =
    typeof mod.default === 'object' && mod.default !== null
      ? (mod.default as Record<string, unknown>)
      : mod;

  for (const [key, val] of Object.entries(fns)) {
    if (typeof val === 'function') {
      exports[`${namespace}_${key}`] = jsDocMap[key] ?? '';
    }
  }

  return { exports };
}

/**
 * Introspect all helper modules from config, returning exports for both mapHelpers and templateHelpers.
 *
 * @param config - Object with optional mapHelpers and templateHelpers config.
 * @param configDir - Directory to resolve relative paths against.
 * @returns Full introspection results for injection into the merged document.
 */
export async function introspectAllHelpers(
  config: {
    mapHelpers?: Record<string, { path: string; description?: string }>;
    templateHelpers?: Record<string, { path: string; description?: string }>;
  },
  configDir: string,
): Promise<AllHelpersIntrospection> {
  const result: AllHelpersIntrospection = {
    mapHelpers: {},
    templateHelpers: {},
  };

  if (config.mapHelpers) {
    for (const [namespace, { path: p }] of Object.entries(config.mapHelpers)) {
      const resolved = resolve(configDir, p);
      result.mapHelpers[namespace] = await introspectHelperModule(
        resolved,
        namespace,
      );
    }
  }

  if (config.templateHelpers) {
    for (const [namespace, { path: p }] of Object.entries(
      config.templateHelpers,
    )) {
      const resolved = resolve(configDir, p);
      result.templateHelpers[namespace] = await introspectHelperModule(
        resolved,
        namespace,
      );
    }
  }

  return result;
}
