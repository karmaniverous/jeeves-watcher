import { readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import picomatch from 'picomatch';

import { normalizeSlashes } from '../util/normalizeSlashes';

/**
 * Best-effort base directory inference for a glob pattern.
 *
 * For our use (watch paths in config), this only needs to be good enough
 * to scan the directory tree in integration tests.
 */
export function globBase(pattern: string): string {
  const normalised = normalizeSlashes(pattern);
  const globIdx = normalised.search(/[*?[]/);

  if (globIdx === -1) return resolve(pattern);
  const prefix = normalised.slice(0, globIdx);
  // If prefix ends mid-segment, dirname to get a real directory
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : dirname(prefix);
  return resolve(base);
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Array<{ name: string; isDirectory: boolean }>;
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    entries = dirents.map((d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
    }));
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory) {
      yield* walk(full);
    } else {
      // ensure it's a file
      try {
        const st = await stat(full);
        if (st.isFile()) yield full;
      } catch {
        // ignore
      }
    }
  }
}

/**
 * List files matching a set of globs, with optional ignore globs and gitignore filter.
 *
 * @param patterns - Glob patterns to match.
 * @param ignored - Glob patterns to exclude (optional).
 * @param isGitignored - Optional callback to check gitignore status per file.
 */
export async function listFilesFromGlobs(
  patterns: string[],
  ignored: string[] = [],
  isGitignored?: (filePath: string) => boolean,
): Promise<string[]> {
  const normPatterns = patterns.map((p) => normalizeSlashes(p));
  const normIgnored = ignored.map((p) => normalizeSlashes(p));

  const match = picomatch(normPatterns, { dot: true, nocase: true });
  const ignore = normIgnored.length
    ? picomatch(normIgnored, { dot: true, nocase: true })
    : () => false;

  const bases = Array.from(new Set(patterns.map(globBase)));

  const seen = new Set<string>();
  for (const base of bases) {
    for await (const file of walk(base)) {
      const rel = normalizeSlashes(file);
      if (ignore(rel)) continue;
      if (!match(rel)) continue;
      if (isGitignored?.(file)) continue;
      seen.add(file);
    }
  }

  return Array.from(seen);
}

/**
 * List files from watch root base directories, applying watch extension globs,
 * ignored globs, gitignore, and an additional caller-provided glob intersection filter.
 *
 * Unlike `listFilesFromGlobs` (which derives walk roots from the glob patterns themselves),
 * this function always walks from watch root base directories and applies the caller's
 * globs as an additional intersection filter within the watched universe.
 *
 * @param watchPatterns - The configured watch path globs (defines the watched universe).
 * @param ignored - Glob patterns to exclude.
 * @param callerGlobs - Additional globs to intersect with. Only files matching both
 *   the watch patterns AND the caller globs are returned.
 * @param isGitignored - Optional callback to check gitignore status per file.
 */
export async function listFilesFromWatchRoots(
  watchPatterns: string[],
  ignored: string[],
  callerGlobs: string[],
  isGitignored?: (filePath: string) => boolean,
): Promise<string[]> {
  const normWatch = watchPatterns.map((p) => normalizeSlashes(p));
  const normIgnored = ignored.map((p) => normalizeSlashes(p));
  const normCaller = callerGlobs.map((p) => normalizeSlashes(p));

  const matchWatch = picomatch(normWatch, { dot: true, nocase: true });
  const matchCaller = picomatch(normCaller, { dot: true, nocase: true });
  const ignore = normIgnored.length
    ? picomatch(normIgnored, { dot: true, nocase: true })
    : () => false;

  // Walk from watch root base directories
  const bases = Array.from(new Set(watchPatterns.map(globBase)));

  const seen = new Set<string>();
  for (const base of bases) {
    for await (const file of walk(base)) {
      const rel = normalizeSlashes(file);
      if (ignore(rel)) continue;
      if (!matchWatch(rel)) continue;
      if (!matchCaller(rel)) continue;
      if (isGitignored?.(file)) continue;
      seen.add(file);
    }
  }

  return Array.from(seen);
}

/**
 * Get the base directories of the configured watch paths.
 */
export function getWatchRootBases(watchPatterns: string[]): string[] {
  return Array.from(new Set(watchPatterns.map(globBase)));
}
