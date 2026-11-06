/**
 * @module watcher/indexCheck/tally
 * The index check's per-root tally (D197): each listed chunk-0 file document is matched to a checked watch root (case-insensitive on Windows only, D195) and counted; those the inventory does not hold are candidates, kept up to one over the cap; the cap is more than 10% of the root's indexed documents once more than 20 are candidates (D198), or more than 1,000. The floor sits far below the kept limit, so a root under it keeps every candidate. Points without a `file_path` (source documents) and points outside the roots are ignored. Pure.
 */

import { FIELD_FILE_PATH } from '../../processor/payloadFields';
import { normalizeSlashes } from '../../util/normalizeSlashes';
import { findRootForPath } from '../../vcs/gitExec';

/** Most candidates a root may have before nothing is deleted there. */
export const INDEX_CHECK_MAX_CANDIDATES = 1000;

/** Largest share of a root's indexed documents that may be candidates. */
export const INDEX_CHECK_MAX_SHARE = 0.1;

/** Candidates a root may have whatever their share of it (D198). */
export const INDEX_CHECK_SHARE_FLOOR = 20;

/**
 * Whether a root's candidates exceed the cap (D197, D198): more than 10% of
 * its indexed documents once more than 20 are candidates, or more than 1,000.
 * The floor applies to the share only, so a small root may lose up to 20.
 *
 * @param candidates - Documents the inventory does not hold.
 * @param indexed - Documents indexed under the root.
 * @returns True when nothing may be deleted under the root.
 */
export function overCap(candidates: number, indexed: number): boolean {
  return (
    candidates > INDEX_CHECK_MAX_CANDIDATES ||
    (candidates > INDEX_CHECK_SHARE_FLOOR &&
      candidates > indexed * INDEX_CHECK_MAX_SHARE)
  );
}

/** One root's tally. */
export interface RootTally {
  /** The root, as given. */
  root: string;
  /** Chunk-0 file documents indexed under it. */
  indexed: number;
  /** Of those, the documents the inventory does not hold. */
  candidates: number;
  /** Candidate paths (stored `file_path`), at most one over the cap. */
  paths: string[];
}

/** Streams listed documents into per-root tallies. */
export class IndexCheckTally {
  private readonly byKey = new Map<string, RootTally>();
  private readonly keys: string[];

  /**
   * @param roots - The roots to check (collapsed, so none nests in another).
   * @param has - Whether the inventory holds a path.
   * @param platform - Case rule for root matching (default this process's).
   */
  constructor(
    roots: readonly string[],
    private readonly has: (path: string) => boolean,
    private readonly platform: string = process.platform,
  ) {
    for (const root of roots) {
      const key = normalizeSlashes(root).replace(/\/+$/, '');
      this.byKey.set(key, { root, indexed: 0, candidates: 0, paths: [] });
    }
    this.keys = [...this.byKey.keys()].sort((a, b) => b.length - a.length);
  }

  /**
   * Count one listed point. A source document has no `file_path`, so it is
   * never counted (nor is a file point outside every root).
   *
   * @param payload - The point's payload (at least `file_path`).
   */
  add(payload: Record<string, unknown>): void {
    const filePath = payload[FIELD_FILE_PATH];
    if (typeof filePath !== 'string' || filePath.length === 0) return;
    const key = findRootForPath(
      this.keys,
      normalizeSlashes(filePath),
      this.platform,
    );
    const tally = key === undefined ? undefined : this.byKey.get(key);
    if (!tally) return;
    tally.indexed += 1;
    if (this.has(filePath)) return;
    tally.candidates += 1;
    if (tally.paths.length <= INDEX_CHECK_MAX_CANDIDATES) {
      tally.paths.push(filePath);
    }
  }

  /** Every root's tally, in the order the roots were given. */
  results(): RootTally[] {
    return [...this.byKey.values()];
  }
}
