/**
 * @module api/reindexPathFiles
 * Resolves the file list of a path-scoped reindex: each target must be watched and not gitignored; directories expand to their watched files. Bad targets throw RequestError (403/404/400). fs I/O (stat, glob).
 */

import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { extractWatchPathStrings } from '@karmaniverous/jeeves-watcher-core';

import type { JeevesWatcherConfig } from '../config/types';
import { createIsGitignored, type GitignoreFilter } from '../gitignore';
import { isPathWatched } from '../util/isPathWatched';
import { isPathWithin } from '../util/isPathWithin';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { listFilesFromGlobs } from './fileScan';
import { invalidRequest, RequestError } from './requestError';

/**
 * Collect and deduplicate files for a path-scoped reindex.
 *
 * Iterates over each target path, resolves its file list, and returns a
 * deduplicated array (used by both the dry-run plan and execution).
 *
 * @param pathArray - Target files or directories.
 * @param config - Service config (watch paths and ignores).
 * @param gitignoreFilter - Gitignore filter, if any.
 * @returns Distinct files to reindex.
 * @throws {@link RequestError}: `403 path_not_watched` when a target is
 *   outside watch scope or gitignored, `404 not_found` when it does not
 *   exist, `400 invalid_request` when it is neither a file nor a directory.
 */
export async function collectPathFiles(
  pathArray: string[],
  config: JeevesWatcherConfig,
  gitignoreFilter: GitignoreFilter | undefined,
): Promise<string[]> {
  // Deduped by slash-normalised path: a file named directly and found again
  // by expanding its directory (OS separators) is reindexed once.
  const unique = new Map<string, string>();
  for (const p of pathArray) {
    const files = await getPathFileList(p, config, gitignoreFilter);
    for (const file of files) {
      const key = normalizeSlashes(file);
      if (!unique.has(key)) unique.set(key, file);
    }
  }
  return [...unique.values()];
}

/**
 * Get the file list for a path-scoped reindex (for plan computation).
 */
async function getPathFileList(
  targetPath: string,
  config: JeevesWatcherConfig,
  gitignoreFilter: GitignoreFilter | undefined,
): Promise<string[]> {
  const watched = isPathWatched(
    targetPath,
    extractWatchPathStrings(config.watch.paths),
    config.watch.ignored,
  );
  if (!watched) {
    throw notWatched(`Path is outside watch scope: ${targetPath}`);
  }
  if (gitignoreFilter?.isIgnored(targetPath)) {
    throw notWatched(`Path is gitignored: ${targetPath}`);
  }

  const stats = await statTarget(targetPath);
  if (stats.isFile()) return [targetPath];

  if (stats.isDirectory()) {
    const isGitignored = createIsGitignored(gitignoreFilter);
    const allWatchedFiles = await listFilesFromGlobs(
      extractWatchPathStrings(config.watch.paths),
      config.watch.ignored,
      isGitignored,
    );
    const targetAbsPath = resolve(targetPath);
    return allWatchedFiles.filter((f) =>
      isPathWithin(resolve(f), targetAbsPath),
    );
  }

  throw invalidRequest(`Path is neither a file nor a directory: ${targetPath}`);
}

/** A `403 path_not_watched` error. */
const notWatched = (message: string): RequestError =>
  new RequestError(403, 'path_not_watched', message);

/**
 * Stat a reindex target; a missing one is `404 not_found`.
 *
 * @param targetPath - The requested path.
 * @returns Its stats.
 */
async function statTarget(targetPath: string): Promise<Stats> {
  try {
    return await stat(targetPath);
  } catch (error) {
    const { code } = error as { code?: unknown };
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new RequestError(404, 'not_found', `Path not found: ${targetPath}`);
    }
    throw error;
  }
}
