/**
 * @module api/reindexPathFiles
 * Resolves the file list of a path-scoped reindex: each target must be watched and not gitignored; directories expand to their watched files. Bad targets throw `PathNotWatched` (403), `PathNotFound` (404) or `PathNotFileOrDirectory` (400). fs I/O (stat, glob).
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
import { PathNotFileOrDirectory, PathNotFound, PathNotWatched } from './errors';
import { listFilesFromGlobs } from './fileScan';

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
 * @throws `PathNotWatched` (403) when a target is outside watch scope or
 *   gitignored, `PathNotFound` (404) when it does not exist,
 *   `PathNotFileOrDirectory` (400) when it is neither a file nor a
 *   directory.
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
    throw new PathNotWatched();
  }
  if (gitignoreFilter?.isIgnored(targetPath)) {
    throw new PathNotWatched();
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

  throw new PathNotFileOrDirectory();
}

/**
 * Stat a reindex target; a missing one is `PathNotFound` (404).
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
      throw new PathNotFound();
    }
    throw error;
  }
}
