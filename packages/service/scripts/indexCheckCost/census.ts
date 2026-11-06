/**
 * @module scripts/indexCheckCost/census
 * The index-check cost run's census of the throwaway copy (chunk-0 file documents per watch root, outside the roots, source documents) and its choice of "missing" documents within each root's cap. Reads the copy only.
 */

import { isSourcePoint } from '../../src/processor/payloadFields';
import { normalizeSlashes } from '../../src/util/normalizeSlashes';
import { findRootForPath } from '../../src/vcs/gitExec';
import type { VectorStoreClient } from '../../src/vectorStore';
import { CHUNK0_FILTER } from '../../src/watcher/indexCheck/runIndexCheck';
import { INDEX_CHECK_MAX_SHARE } from '../../src/watcher/indexCheck/tally';

/** Points by kind: file documents under the roots, outside, sources. */
export interface Census {
  points: number;
  chunk0UnderRoots: number;
  chunk0Outside: number;
  chunk0Sources: number;
  /** Chunk-0 file paths under the roots, by root. */
  byRoot: Map<string, string[]>;
}

/**
 * Scroll the copy's chunk-0 points into a census (not timed).
 *
 * @param store - The copy.
 * @param rootKeys - Normalized root keys, longest first.
 * @returns The census.
 */
export async function census(
  store: VectorStoreClient,
  rootKeys: string[],
): Promise<Census> {
  const result: Census = {
    points: (await store.getCollectionInfo()).pointCount,
    chunk0UnderRoots: 0,
    chunk0Outside: 0,
    chunk0Sources: 0,
    byRoot: new Map(),
  };
  let cursor: string | number | undefined;
  do {
    const page = await store.scrollPage(CHUNK0_FILTER, 2000, cursor, [
      'file_path',
      'source',
    ]);
    for (const { payload } of page.points) {
      if (isSourcePoint(payload)) {
        result.chunk0Sources += 1;
        continue;
      }
      const filePath = payload.file_path;
      if (typeof filePath !== 'string') continue;
      const root = findRootForPath(
        rootKeys,
        normalizeSlashes(filePath),
        process.platform,
      );
      if (root === undefined) {
        result.chunk0Outside += 1;
        continue;
      }
      result.chunk0UnderRoots += 1;
      const list = result.byRoot.get(root) ?? [];
      list.push(filePath);
      result.byRoot.set(root, list);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return result;
}

/**
 * Choose missing documents per root, within each root's cap.
 *
 * @param before - The census.
 * @param missingWanted - How many to choose in all (spread by root size).
 * @returns The chosen paths.
 */
export function chooseMissing(
  before: Census,
  missingWanted: number,
): Set<string> {
  const total = before.chunk0UnderRoots;
  const missing = new Set<string>();
  for (const paths of before.byRoot.values()) {
    const share = Math.round((missingWanted * paths.length) / total);
    const cap = Math.min(
      1000,
      Math.floor(paths.length * INDEX_CHECK_MAX_SHARE),
    );
    const n = Math.min(share, cap);
    for (let i = 0; i < n; i++) {
      missing.add(paths[Math.floor((i * paths.length) / n)]);
    }
  }
  return missing;
}
