/**
 * @module watcher/changeSource/parcelIgnore
 * The `ignore` list one parcel subscription gets (D126, D152, D156): the root's `.git` always, plus `watch.ignored` made root-relative by the exact rule. An optimisation only; `FileSystemWatcher` filters every event. Pure.
 */

import { posix, win32 } from 'node:path';

import { normalizeSlashes } from '../../util/normalizeSlashes';
import { globRoot } from '../globToDir';

/** Whether a pattern is an absolute path or glob on `platform`. */
function isAbsolutePattern(
  pattern: string,
  platform: NodeJS.Platform,
): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(pattern)
    : posix.isAbsolute(pattern);
}

/**
 * One `watch.ignored` pattern for `root`, or undefined to omit it: a
 * relative pattern passes unchanged; an absolute one passes, made
 * relative, only when its literal prefix (the path segments before the
 * first glob character) is the root or lies under it, compared
 * case-insensitively on Windows; every other pattern is omitted (D156).
 *
 * @param pattern - A `watch.ignored` entry.
 * @param root - The subscription's root.
 * @param platform - `process.platform`.
 * @returns The root-relative pattern, or undefined.
 */
export function rootRelativeIgnore(
  pattern: string,
  root: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (!isAbsolutePattern(pattern, platform)) return pattern;
  const fold = (s: string) => (platform === 'win32' ? s.toLowerCase() : s);
  const base = normalizeSlashes(root).replace(/\/+$/, '');
  const normalized = normalizeSlashes(pattern);
  const prefix = fold(globRoot(normalized));
  const rootKey = fold(base);
  if (prefix !== rootKey && !prefix.startsWith(`${rootKey}/`)) {
    return undefined;
  }
  const relative = normalized.slice(base.length + 1);
  return relative === '' ? undefined : relative;
}

/**
 * The `ignore` option for `root`'s subscription: its `.git` (D152) and
 * every `watch.ignored` pattern the rule keeps. Computed once per source
 * build (D179).
 *
 * @param ignored - `watch.ignored`.
 * @param root - The subscription's root.
 * @param platform - `process.platform` (default the running one).
 * @returns Root-relative paths and globs.
 */
export function parcelIgnore(
  ignored: readonly string[],
  root: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const kept = ignored.flatMap(
    (pattern) => rootRelativeIgnore(pattern, root, platform) ?? [],
  );
  return ['.git', ...kept];
}
