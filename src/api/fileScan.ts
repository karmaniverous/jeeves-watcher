import { readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import picomatch from 'picomatch';

/**
 * Best-effort base directory inference for a glob pattern.
 *
 * For our use (watch paths in config), this only needs to be good enough
 * to scan the directory tree in integration tests.
 */
export function globBase(pattern: string): string {
  const normalised = pattern.replace(/\\/g, '/');
  // eslint-disable-next-line no-useless-escape
  const globIdx = normalised.search(/[*?\[]/);
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
 * List files matching a set of globs, with optional ignore globs.
 */
export async function listFilesFromGlobs(
  patterns: string[],
  ignored: string[] = [],
): Promise<string[]> {
  const normPatterns = patterns.map((p) => p.replace(/\\/g, '/'));
  const normIgnored = ignored.map((p) => p.replace(/\\/g, '/'));

  const match = picomatch(normPatterns, { dot: true });
  const ignore = normIgnored.length
    ? picomatch(normIgnored, { dot: true })
    : () => false;

  const bases = Array.from(new Set(patterns.map(globBase)));

  const seen = new Set<string>();
  for (const base of bases) {
    for await (const file of walk(base)) {
      const rel = file.replace(/\\/g, '/');
      if (ignore(rel)) continue;
      if (!match(rel)) continue;
      seen.add(file);
    }
  }

  return Array.from(seen);
}
