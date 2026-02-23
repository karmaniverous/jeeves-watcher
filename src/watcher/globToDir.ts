/**
 * @module watcher/globToDir
 * Adapts glob-based watch config to chokidar v4+, which removed glob support
 * (see paulmillr/chokidar#1350). Chokidar v4 treats glob patterns as literal
 * strings, silently producing zero events. This module extracts static directory
 * roots from glob patterns for chokidar to watch, then filters emitted events
 * against the original globs via picomatch.
 */

import picomatch from 'picomatch';

/**
 * Extract the static directory root from a glob pattern.
 * Stops at the first segment containing glob characters (`*`, `{`, `?`, `[`).
 *
 * @param glob - A glob pattern (e.g., `j:/domains/**\/*.json`).
 * @returns The static directory prefix (e.g., `j:/domains`).
 */
export function globRoot(glob: string): string {
  const normalized = glob.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const staticSegments: string[] = [];

  for (const seg of segments) {
    if (/[*?{[\]]/.test(seg)) break;
    staticSegments.push(seg);
  }

  return staticSegments.join('/') || '.';
}

/**
 * Deduplicate directory roots, removing paths that are subdirectories of others.
 *
 * @param roots - Array of directory paths.
 * @returns Deduplicated array with subdirectories removed.
 */
export function deduplicateRoots(roots: string[]): string[] {
  const normalized = roots.map((r) => r.replace(/\\/g, '/').toLowerCase());
  const sorted = [...new Set(normalized)].sort();

  return sorted.filter((root, _i, arr) => {
    const withSlash = root.endsWith('/') ? root : root + '/';
    return !arr.some(
      (other) => other !== root && withSlash.startsWith(other + '/'),
    );
  });
}

/**
 * Build a picomatch matcher from an array of glob patterns.
 * Normalizes Windows paths (backslash → forward slash, lowercase drive letter)
 * before matching.
 *
 * @param globs - Glob patterns to match against.
 * @returns A function that tests whether a file path matches any of the globs.
 */
export function buildGlobMatcher(
  globs: string[],
): (filePath: string) => boolean {
  const normalizedGlobs = globs.map((g) => g.replace(/\\/g, '/'));
  const isMatch = picomatch(normalizedGlobs, { dot: true, nocase: true });

  return (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/');
    return isMatch(normalized);
  };
}

/**
 * Convert an array of glob patterns into chokidar-compatible directory roots
 * and a filter function for post-hoc event filtering.
 *
 * @param globs - Glob patterns from the watch config.
 * @returns Object with `roots` (directories for chokidar) and `matches` (filter function).
 */
export function resolveWatchPaths(globs: string[]): {
  roots: string[];
  matches: (filePath: string) => boolean;
} {
  const rawRoots = globs.map(globRoot);
  const roots = deduplicateRoots(rawRoots);
  const matches = buildGlobMatcher(globs);
  return { roots, matches };
}

/**
 * Convert ignored glob patterns to picomatch matcher functions.
 *
 * Chokidar v5 replaced the external `anymatch` dependency with an inline
 * implementation that does **exact string equality** for string matchers,
 * breaking glob-based `ignored` patterns. This function converts glob strings
 * to picomatch functions that chokidar's `createPattern` passes through
 * unchanged (`typeof matcher === 'function'`).
 *
 * Non-string entries (functions, RegExps) are passed through as-is.
 *
 * @param ignored - Array of ignored patterns (globs, functions, RegExps).
 * @returns Array with glob strings replaced by picomatch matcher functions.
 */
export function resolveIgnored(
  ignored: (string | RegExp | ((path: string) => boolean))[],
): (string | RegExp | ((path: string) => boolean))[] {
  return ignored.map((entry) => {
    if (typeof entry !== 'string') return entry;
    // If the string contains glob characters, convert to a picomatch function.
    // Literal strings (exact paths) are also converted for consistent matching.
    const normalizedPattern = entry.replace(/\\/g, '/');
    const matcher = picomatch(normalizedPattern, { dot: true, nocase: true });
    return (filePath: string) => {
      const normalized = filePath.replace(/\\/g, '/');
      return matcher(normalized);
    };
  });
}
