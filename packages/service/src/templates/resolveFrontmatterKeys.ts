/**
 * @module templates/resolveFrontmatterKeys
 * Resolves frontmatter key patterns (with glob/negation support) against
 * available context keys. Patterns prefixed with `!` are exclusions.
 * Supports picomatch glob syntax (e.g. `*`, `_*`, `chunk_*`).
 */

import picomatch from 'picomatch';

/**
 * Resolve frontmatter patterns against available keys.
 *
 * @param patterns - Array of key names or glob patterns. `!`-prefixed patterns exclude.
 * @param allKeys - All available keys from the rendering context.
 * @returns Ordered array of resolved keys: explicit names in declaration order,
 *   then glob-matched names sorted alphabetically, minus exclusions.
 */
export function resolveFrontmatterKeys(
  patterns: string[],
  allKeys: string[],
): string[] {
  const includes: string[] = [];
  const excludePatterns: string[] = [];

  for (const p of patterns) {
    if (p.startsWith('!')) {
      excludePatterns.push(p.slice(1));
    } else {
      includes.push(p);
    }
  }

  const isExcluded = excludePatterns.length
    ? picomatch(excludePatterns)
    : () => false;

  // Collect keys: explicit names first (in order), then glob-expanded (sorted).
  const result: string[] = [];
  const seen = new Set<string>();

  // Pass 1: explicit (non-glob) names — preserved in declaration order.
  const explicitNames: string[] = [];
  const globPatterns: string[] = [];

  for (const p of includes) {
    if (isGlob(p)) {
      globPatterns.push(p);
    } else {
      explicitNames.push(p);
    }
  }

  for (const name of explicitNames) {
    if (!isExcluded(name) && allKeys.includes(name) && !seen.has(name)) {
      result.push(name);
      seen.add(name);
    }
  }

  // Pass 2: glob patterns — matched keys sorted alphabetically.
  if (globPatterns.length) {
    const isIncluded = picomatch(globPatterns);
    const matched = allKeys.filter((k) => isIncluded(k)).sort();
    for (const key of matched) {
      if (!isExcluded(key) && !seen.has(key)) {
        result.push(key);
        seen.add(key);
      }
    }
  }

  return result;
}

/** Check whether a pattern contains glob characters. */
function isGlob(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}
