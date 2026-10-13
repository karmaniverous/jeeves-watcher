/**
 * @module util/isPathWithin
 * Separator-aware path containment: `/docs` contains `/docs/a.md` but not `/docs2/a.md`. Slashes normalised; case-sensitive. Pure.
 */

import { normalizeSlashes } from './normalizeSlashes';

/**
 * Whether `path` is `root` itself or lies beneath it. An empty root
 * contains every path.
 *
 * @param path - Candidate path.
 * @param root - Containing directory.
 * @returns `true` when `path` is `root` or a descendant of it.
 */
export function isPathWithin(path: string, root: string): boolean {
  const base = normalizeSlashes(root).replace(/\/+$/, '');
  if (base.length === 0) return true;
  const candidate = normalizeSlashes(path);
  return candidate === base || candidate.startsWith(`${base}/`);
}
