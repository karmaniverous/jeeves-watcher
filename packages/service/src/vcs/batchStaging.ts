/**
 * @module vcs/batchStaging
 * Stage a commit batch so that a missing path never fails it: existing
 * files are added, tracked files that vanished have their deletion staged,
 * and never-tracked files that vanished are dropped. See #249.
 */

import { stat } from 'node:fs/promises';

import type pino from 'pino';

import { getErrorCode, GIT_TIMEOUT_STANDARD, pathKey } from './gitExec';
import {
  gitAddViaStdin,
  gitRmCachedViaStdin,
  listDeletedTrackedPaths,
} from './gitIndex';

/** A batch split by on-disk and index state. */
export interface ClassifiedBatch {
  /** Files present on disk: stage with `git add`. */
  existing: string[];
  /** Files gone from disk but tracked: stage their removal. */
  missingTracked: string[];
  /** Files gone from disk and never tracked: nothing to record. */
  missingUntracked: string[];
}

/** Errno codes that mean "this path does not exist". */
const MISSING_CODES: ReadonlySet<string | number> = new Set([
  'ENOENT',
  'ENOTDIR',
]);

/**
 * Check whether a path exists. Only "does not exist" errors count as
 * missing; any other failure (permissions, I/O) propagates so the batch is
 * retained and retried rather than silently dropping a real change.
 *
 * @param path - Absolute path to check.
 * @param statFn - Stat implementation (injectable for tests).
 * @returns true if the path exists.
 */
async function pathExists(
  path: string,
  statFn: (p: string) => Promise<unknown>,
): Promise<boolean> {
  try {
    await statFn(path);
    return true;
  } catch (error) {
    if (MISSING_CODES.has(getErrorCode(error) ?? '')) return false;
    throw error;
  }
}

/**
 * Split a batch into existing, missing-tracked, and missing-untracked
 * paths. Uses one `git ls-files --deleted` call, and only when something is
 * missing.
 *
 * @param files - Absolute paths in the batch.
 * @param rootPath - Repository root.
 * @param statFn - Stat implementation (injectable for tests).
 * @returns The classified batch.
 */
export async function classifyBatchPaths(
  files: string[],
  rootPath: string,
  statFn: (p: string) => Promise<unknown> = stat,
): Promise<ClassifiedBatch> {
  const exists = await Promise.all(files.map((f) => pathExists(f, statFn)));
  const existing = files.filter((_, i) => exists[i]);
  const missing = files.filter((_, i) => !exists[i]);
  if (missing.length === 0) {
    return { existing, missingTracked: [], missingUntracked: [] };
  }

  const deletedTracked = new Set(
    (await listDeletedTrackedPaths(rootPath)).map((p) => pathKey(p)),
  );
  const isTracked = (f: string) => deletedTracked.has(pathKey(f));
  return {
    existing,
    missingTracked: missing.filter(isTracked),
    missingUntracked: missing.filter((f) => !isTracked(f)),
  };
}

/**
 * Stage a batch: add existing files, stage removal of tracked files that
 * are gone, and drop never-tracked files that are gone.
 *
 * @param files - Absolute paths in the batch.
 * @param rootPath - Repository root.
 * @param logger - Logger (dropped paths are reported at debug).
 * @param timeoutMs - Timeout for each git call.
 */
export async function stageBatch(
  files: string[],
  rootPath: string,
  logger: pino.Logger,
  timeoutMs = GIT_TIMEOUT_STANDARD,
): Promise<void> {
  const { existing, missingTracked, missingUntracked } =
    await classifyBatchPaths(files, rootPath);

  if (missingUntracked.length > 0) {
    logger.debug(
      { root: rootPath, count: missingUntracked.length },
      'Dropping missing, untracked paths from batch',
    );
  }

  await gitAddViaStdin(existing, rootPath, timeoutMs);
  await gitRmCachedViaStdin(missingTracked, rootPath, timeoutMs);
}
