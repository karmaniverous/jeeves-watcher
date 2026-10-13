/**
 * @module api/reindexPlan
 * Reindex blast-area plan type (core `ReindexPlan`, re-exported) and the per-watch-root grouping helper shared by prune and file-scope plans. Pure, no I/O.
 */

import { isPathWithin } from '../util/isPathWithin';
import { normalizeSlashes } from '../util/normalizeSlashes';

export type { ReindexPlan } from '@karmaniverous/jeeves-watcher-core';

/**
 * Group file paths by their watch root prefix.
 * Each file is grouped under the first watch root (glob up to `**`) that
 * contains it, separator-aware: root `/w/docs` never claims `/w/docs2/a.md`.
 * Files that don't match any root are grouped under `'(unmatched)'`.
 *
 * @param filePaths - File paths to group.
 * @param watchPaths - Watch path globs.
 * @returns Count per root.
 */
export function groupByRoot(
  filePaths: string[],
  watchPaths: string[],
): Record<string, number> {
  const byRoot: Record<string, number> = {};
  for (const fp of filePaths) {
    const normalised = normalizeSlashes(fp);
    let matched = false;
    for (const root of watchPaths) {
      const rootNorm = normalizeSlashes(root).replace(/\/?\*\*.*$/, '');
      if (isPathWithin(normalised, rootNorm)) {
        byRoot[rootNorm] = (byRoot[rootNorm] ?? 0) + 1;
        matched = true;
        break;
      }
    }
    if (!matched) {
      byRoot['(unmatched)'] = (byRoot['(unmatched)'] ?? 0) + 1;
    }
  }
  return byRoot;
}
