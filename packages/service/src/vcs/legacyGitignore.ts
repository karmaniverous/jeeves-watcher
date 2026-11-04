/**
 * @module vcs/legacyGitignore
 * Removal of an exclude pattern jeeves-watcher 0.20.0 wrote into a `.gitignore` by the locality rule (D3): the deepest literal directory of the glob holds the file, and the line is the rest of the glob, un-anchored. Reads and writes that file.
 *
 * 0.21.0 writes new patterns to `.git/info/exclude` (D54); this only lets
 * `remove` undo an old one (Design 5, D81).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeSlashes } from '../util/normalizeSlashes';

/** Why a 0.20.0 pattern could not be removed (0.20.0's own texts). */
export class LegacyPatternNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyPatternNotFoundError';
  }
}

/**
 * Split a root-relative glob as 0.20.0 did: the directory is the literal
 * segments before the first wildcard segment (or the parent of a literal
 * path), the pattern is the rest. Pure.
 *
 * @param relativeGlob - Glob relative to the root, no leading `/`.
 * @returns The directory (`.` for the root) and the line 0.20.0 wrote.
 */
export function splitGlobForLocality(relativeGlob: string): {
  dir: string;
  pattern: string;
} {
  const segments = relativeGlob.split('/');
  const firstWild = segments.findIndex((s) => /[*?[\]{}]/.test(s));
  const split = firstWild === -1 ? segments.length - 1 : firstWild;
  return {
    dir: segments.slice(0, split).join('/') || '.',
    pattern: segments.slice(split).join('/'),
  };
}

/**
 * Remove the line 0.20.0 wrote for `relativeGlob` from its locality
 * `.gitignore`.
 *
 * @param root - Repository root.
 * @param relativeGlob - Glob relative to the root, no leading `/`.
 * @returns The `.gitignore` path (forward slashes).
 * @throws LegacyPatternNotFoundError when the file or the line is missing.
 */
export async function removeLegacyGitignoreLine(
  root: string,
  relativeGlob: string,
): Promise<string> {
  const { dir, pattern } = splitGlobForLocality(relativeGlob);
  const file = normalizeSlashes(join(root, dir, '.gitignore'));
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch {
    throw new LegacyPatternNotFoundError(
      'No .gitignore found at the expected location',
    );
  }
  const lines = content.split('\n');
  const kept = lines.filter((line) => line.trim() !== pattern);
  if (kept.length === lines.length) {
    throw new LegacyPatternNotFoundError('Pattern not found in .gitignore');
  }
  await writeFile(file, kept.join('\n'), 'utf8');
  return file;
}
