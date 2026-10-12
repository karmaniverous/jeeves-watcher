/**
 * @module api/reindexPathFiles
 * Resolves the file list of a path-scoped reindex: each target must be watched and not gitignored; directories expand to their watched files. fs I/O (stat, glob).
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { extractWatchPathStrings } from '@karmaniverous/jeeves-watcher-core';

import type { JeevesWatcherConfig } from '../config/types';
import { createIsGitignored, type GitignoreFilter } from '../gitignore';
import { isPathWatched } from '../util/isPathWatched';
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
 * @throws When a target is outside watch scope, gitignored, or neither a
 *   file nor a directory.
 */
export async function collectPathFiles(
  pathArray: string[],
  config: JeevesWatcherConfig,
  gitignoreFilter: GitignoreFilter | undefined,
): Promise<string[]> {
  const allFiles: string[] = [];
  for (const p of pathArray) {
    const files = await getPathFileList(p, config, gitignoreFilter);
    allFiles.push(...files);
  }
  return [...new Set(allFiles)];
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
    throw new Error(`Path is outside watch scope: ${targetPath}`);
  }
  if (gitignoreFilter?.isIgnored(targetPath)) {
    throw new Error(`Path is gitignored: ${targetPath}`);
  }

  const stats = await stat(targetPath);
  if (stats.isFile()) return [targetPath];

  if (stats.isDirectory()) {
    const isGitignored = createIsGitignored(gitignoreFilter);
    const allWatchedFiles = await listFilesFromGlobs(
      extractWatchPathStrings(config.watch.paths),
      config.watch.ignored,
      isGitignored,
    );
    const targetAbsPath = resolve(targetPath);
    return allWatchedFiles.filter((f) => resolve(f).startsWith(targetAbsPath));
  }

  throw new Error(`Path is neither a file nor a directory: ${targetPath}`);
}
