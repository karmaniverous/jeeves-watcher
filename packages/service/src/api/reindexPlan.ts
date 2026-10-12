/**
 * @module api/reindexPlan
 * Reindex blast-area plan type and the per-watch-root grouping helper shared by prune and file-scope plans. Pure, no I/O.
 */

import { normalizeSlashes } from '../util/normalizeSlashes';

/** Blast area plan showing impact of a reindex operation. */
export interface ReindexPlan {
  /** Total points (prune) or files and source documents (other scopes) examined. */
  total: number;
  /** Number of items to process (embed/re-apply rules). */
  toProcess: number;
  /** Number of points to delete (prune only, 0 for others). */
  toDelete: number;
  /** Counts grouped by watch root path (files) or source name (source documents). */
  byRoot: Record<string, number>;
  /** True when scroll was interrupted and results are partial. */
  incomplete?: boolean;
}

/**
 * Group file paths by their watch root prefix.
 * Each file is matched against `watchPaths` and grouped under the first matching root.
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
      if (normalised.startsWith(rootNorm)) {
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
