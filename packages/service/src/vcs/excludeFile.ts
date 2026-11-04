/**
 * @module vcs/excludeFile
 * A root's VCS-only exclude file, `.git/info/exclude` (D54): add a pattern line (idempotent) or remove one. Reads and writes that file; never runs git.
 *
 * git honours the file in `add`, `check-ignore` and `status`; the watcher's
 * `GitignoreFilter` never reads it, so a pattern here stops history without
 * dropping the file from search.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { normalizeSlashes } from '../util/normalizeSlashes';

/**
 * Path of a root's exclude file, forward slashes.
 *
 * @param root - Repository root.
 * @returns `<root>/.git/info/exclude`.
 */
export function excludeFilePath(root: string): string {
  return normalizeSlashes(join(root, '.git', 'info', 'exclude'));
}

/** The file's text, or undefined when it does not exist. */
async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** The file's lines (CRLF or LF). */
const linesOf = (text: string) => text.split(/\r?\n/);

/**
 * Whether a line holds `pattern`: git ignores a line's trailing spaces,
 * while leading ones are part of the pattern.
 */
const holds = (line: string, pattern: string) =>
  line.replace(/ +$/, '') === pattern;

/**
 * Append `pattern` as its own line, unless a line already holds it
 * (trailing spaces ignored). Creates `.git/info` when missing.
 *
 * @param root - Repository root.
 * @param pattern - The gitignore pattern.
 * @returns true when the line was appended, false when it was already there.
 */
export async function addExcludeLine(
  root: string,
  pattern: string,
): Promise<boolean> {
  const file = excludeFilePath(root);
  const text = (await readText(file)) ?? '';
  if (linesOf(text).some((line) => holds(line, pattern))) return false;
  await mkdir(dirname(file), { recursive: true });
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  await writeFile(file, `${text}${separator}${pattern}\n`, 'utf8');
  return true;
}

/**
 * Remove every line holding `pattern` (trailing spaces ignored).
 *
 * @param root - Repository root.
 * @param pattern - The gitignore pattern.
 * @returns true when a line was removed; false when none held it or the
 *   file does not exist.
 */
export async function removeExcludeLine(
  root: string,
  pattern: string,
): Promise<boolean> {
  const file = excludeFilePath(root);
  const text = await readText(file);
  if (text === undefined) return false;
  const lines = linesOf(text);
  const kept = lines.filter((line) => !holds(line, pattern));
  if (kept.length === lines.length) return false;
  await writeFile(file, kept.join('\n'), 'utf8');
  return true;
}
