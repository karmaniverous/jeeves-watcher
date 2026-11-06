/**
 * @module watcher/indexCheck/runIndexCheck
 * The index check at start (D197): after the start walk, list the index's chunk-0 file documents (one scroll), tally them per checked watch root against the inventory, and delete those whose file is confirmed gone, each through the delete-event path (VCS hook, then the processor's delete under its document lock, D98). Skips unavailable, unwatched, walk-failed and gone roots; deletes nothing under a root over the cap; never touches source documents or points outside the roots. I/O: Qdrant scroll, `lstat`, deletes.
 */

import { lstat } from 'node:fs/promises';

import type pino from 'pino';

import {
  FIELD_CHUNK_INDEX,
  FIELD_FILE_PATH,
} from '../../processor/payloadFields';
import { normalizeError } from '../../util/normalizeError';
import { scrollPageWithRetry } from '../../vectorStore/scrollRetry';
import type { VectorStore } from '../../vectorStore/types';
import type { VcsFileChange } from '../fileEvents';
import { isGone as statIsGone } from '../walk/statFile';
import type {
  IndexCheckCounts,
  IndexCheckHealthTracker,
} from './IndexCheckHealthTracker';
import { IndexCheckTally, overCap, type RootTally } from './tally';
import type { IndexCheckView } from './view';

/** Points per scroll page. */
export const INDEX_CHECK_PAGE_SIZE = 1000;

/** One point per document: its chunk 0. */
export const CHUNK0_FILTER = {
  must: [{ key: FIELD_CHUNK_INDEX, match: { value: 0 } }],
};

/** What the index check needs. */
export interface IndexCheckDeps {
  /** The running watcher's roots, skip reasons and inventory. */
  view: IndexCheckView;
  /** The index. */
  vectorStore: Pick<VectorStore, 'scrollPage'>;
  /** The processor's delete (document lock, enrichment, hash cache). */
  deleteFile: (path: string) => Promise<void>;
  /** The VCS hook a delete event calls. */
  onVcsFileChange?: VcsFileChange;
  /** `health.indexCheck`. */
  health: IndexCheckHealthTracker;
  /** Logger. */
  logger: pino.Logger;
  /** Whether the service is stopping. */
  stopped?: () => boolean;
  /** Whether a file is confirmed gone (default: `lstat` ENOENT/ENOTDIR). */
  isGone?: (path: string) => Promise<boolean>;
  /** Whether a root is gone or unreadable (default: `lstat` fails). */
  rootGone?: (root: string) => Promise<boolean>;
  /** Case rule for root matching (default this process's platform). */
  platform?: string;
  /** Points per scroll page. */
  pageSize?: number;
}

/**
 * How a run ended: `stale` when the watcher was rebuilt (or stopped)
 * while the service runs on, so the check belongs to the next watcher.
 */
export type IndexCheckOutcome = 'done' | 'failed' | 'stale';

/** The watcher stopped or was rebuilt, or the service is stopping. */
class IndexCheckStopped extends Error {
  constructor() {
    super('The watcher stopped or was rebuilt during the index check');
  }
}

/** Whether `lstat(root)` fails. */
async function lstatFails(root: string): Promise<boolean> {
  try {
    await lstat(root);
    return false;
  } catch {
    return true;
  }
}

/** Throw when the check must stop. */
function assertActive(deps: IndexCheckDeps): void {
  if (deps.stopped?.() || !deps.view.live()) throw new IndexCheckStopped();
}

/** The roots to check; counts and logs the others. */
async function checkableRoots(
  deps: IndexCheckDeps,
  counts: IndexCheckCounts,
): Promise<string[]> {
  const roots: string[] = [];
  for (const root of deps.view.roots) {
    const reason =
      deps.view.skipReason(root) ??
      ((await (deps.rootGone ?? lstatFails)(root)) ? 'gone' : undefined);
    if (reason === undefined) {
      roots.push(root);
      continue;
    }
    counts.skippedRoots += 1;
    deps.logger.info({ root, reason }, 'Index check skips the watch root');
  }
  return roots;
}

/** List every chunk-0 point into per-root tallies. */
async function tallyIndex(
  deps: IndexCheckDeps,
  roots: string[],
): Promise<RootTally[]> {
  const tally = new IndexCheckTally(roots, deps.view.has, deps.platform);
  let cursor: string | number | undefined;
  do {
    assertActive(deps);
    const page = await scrollPageWithRetry(
      deps.vectorStore,
      {
        filter: CHUNK0_FILTER,
        limit: deps.pageSize ?? INDEX_CHECK_PAGE_SIZE,
        cursor,
        fields: [FIELD_FILE_PATH],
        label: 'Index check',
      },
      deps.logger,
    );
    for (const point of page.points) tally.add(point.payload);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tally.results();
}

/** Delete a root's candidates whose files are confirmed gone. */
async function removeGone(
  deps: IndexCheckDeps,
  tally: RootTally,
): Promise<number> {
  const isGone = deps.isGone ?? statIsGone;
  let removed = 0;
  for (const path of tally.paths) {
    assertActive(deps);
    // A file still on disk but filtered (or unreadable to the walk) is
    // prune's (Design 9). The inventory is read after the stat: an event
    // that re-created the file meanwhile wins, and nothing awaits between
    // this read and the delete taking its place on the document lock.
    if (!(await isGone(path)) || deps.view.has(path)) continue;
    deps.onVcsFileChange?.(path, 'unlink');
    await deps.deleteFile(path);
    removed += 1;
  }
  return removed;
}

/** Apply one root's tally: cap, or delete what is gone. */
async function applyTally(
  deps: IndexCheckDeps,
  tally: RootTally,
  counts: IndexCheckCounts,
): Promise<void> {
  const { root, indexed, candidates } = tally;
  counts.checked += indexed;
  if (overCap(candidates, indexed)) {
    counts.capped += 1;
    deps.logger.warn(
      { root, indexed, candidates },
      'Index check: more than 10% (or 1,000) of the documents indexed under this root are missing from the watcher inventory (gone, or now filtered out); nothing deleted there. Run reindex prune deliberately (dry run first).',
    );
    return;
  }
  const removed = await removeGone(deps, tally);
  counts.removed += removed;
  if (candidates > 0) {
    deps.logger.info(
      { root, indexed, candidates, removed },
      'Index check removed documents whose files are gone',
    );
  }
}

/**
 * Run the index check once. Never rejects: a listing failure, or the
 * watcher stopping, ends it `failed` (nothing is deleted after that).
 *
 * @param deps - View, index, delete path, health and logger.
 * @returns How it ended (`stale`: the watcher went away, the service did not).
 */
export async function runIndexCheck(
  deps: IndexCheckDeps,
): Promise<IndexCheckOutcome> {
  const counts: IndexCheckCounts = {
    checked: 0,
    removed: 0,
    skippedRoots: 0,
    capped: 0,
  };
  deps.health.start();
  try {
    const roots = await checkableRoots(deps, counts);
    const tallies = roots.length > 0 ? await tallyIndex(deps, roots) : [];
    for (const tally of tallies) await applyTally(deps, tally, counts);
    deps.health.finish('done', counts);
    deps.logger.info({ ...counts }, 'Index check at start done');
    return 'done';
  } catch (error) {
    deps.health.finish('failed', counts);
    const stale = error instanceof IndexCheckStopped && !deps.stopped?.();
    deps.logger[stale ? 'warn' : 'error'](
      { err: normalizeError(error), ...counts },
      stale
        ? 'Index check at start interrupted by a watcher rebuild; it runs again after the new initial scan'
        : 'Index check at start failed; nothing more is deleted',
    );
    return stale ? 'stale' : 'failed';
  }
}
