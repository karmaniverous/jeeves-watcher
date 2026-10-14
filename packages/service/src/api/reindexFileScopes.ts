/**
 * @module api/reindexFileScopes
 * File side of reindex scopes `issues`, `full`, `rules` and `path`: lists the scope's files, builds the per-root plan, and processes them with bounded concurrency (one error policy: failures are collected, never stop the run). fs I/O plus processor calls.
 */

import {
  extractWatchPathStrings,
  type ReindexScope,
} from '@karmaniverous/jeeves-watcher-core';

import type { JeevesWatcherConfig } from '../config/types';
import { createIsGitignored } from '../gitignore';
import { isSourceReference } from '../util/documentKey';
import { listFilesFromGlobs, listFilesFromWatchRoots } from './fileScan';
import { collectPathFiles } from './reindexPathFiles';
import { groupByRoot, type ReindexPlan } from './reindexPlan';
import type { ExecuteReindexDeps } from './reindexTypes';
import { processEach, reindexConcurrency } from './reindexWork';

/**
 * Build the plan for a list of files (nothing to delete).
 *
 * @param files - Files the scope will process.
 * @param config - Service config (watch roots for grouping).
 * @returns The plan.
 */
export function filePlan(
  files: string[],
  config: JeevesWatcherConfig,
): ReindexPlan {
  return {
    total: files.length,
    toProcess: files.length,
    toDelete: 0,
    byRoot: groupByRoot(files, extractWatchPathStrings(config.watch.paths)),
  };
}

/**
 * List the files of a non-prune scope before execution.
 *
 * - `issues`: the file-path keys of the issues store (when present).
 * - `path`: the targets, directories expanded ({@link collectPathFiles};
 *   throws `RequestError` for a target that is not watched or missing).
 * - `rules` with paths: watch roots intersected with the caller's globs.
 * - otherwise: every watched file.
 *
 * @param deps - Reindex dependencies.
 * @param scope - Reindex scope (not `prune`).
 * @param pathArray - Target paths/globs (`path` and `rules` scopes).
 * @returns The scope's files.
 */
export async function listScopeFiles(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  pathArray: string[] | undefined,
): Promise<string[]> {
  const { config } = deps;
  const isGitignored = createIsGitignored(deps.gitignoreFilter);
  const watchPaths = extractWatchPathStrings(config.watch.paths);

  if (scope === 'issues' && deps.issuesManager) {
    // Source references are issue keys too; they are never files.
    return Object.keys(deps.issuesManager.getAll()).filter(
      (key) => !isSourceReference(key),
    );
  }
  if (scope === 'path' && pathArray) {
    return collectPathFiles(pathArray, config, deps.gitignoreFilter);
  }
  if (scope === 'rules' && pathArray && pathArray.length > 0) {
    return listFilesFromWatchRoots(
      watchPaths,
      config.watch.ignored,
      pathArray,
      isGitignored,
    );
  }
  // rules or full: list files from globs
  return listFilesFromGlobs(watchPaths, config.watch.ignored, isGitignored);
}

/** Outcome of {@link runFileScope}. */
export interface FileScopeOutcome {
  /** Files processed successfully. */
  filesProcessed: number;
  /** Files whose processing threw (logged; the run continued). */
  failed: string[];
}

/**
 * Process the files of a non-prune scope with `reindex.concurrency`: scope
 * `rules` re-applies rules (`processRulesUpdate`), every other scope
 * re-processes the file (`processFile`). Every scope follows the same error
 * policy ({@link processEach}): a failing file is logged and collected and
 * the remaining files still run; progress is reported after every file.
 *
 * @param deps - Reindex dependencies.
 * @param scope - Reindex scope (not `prune`).
 * @param fileList - Files from {@link listScopeFiles}.
 * @param onProcessed - Called after each file.
 * @returns Files processed and the files that failed.
 */
export async function runFileScope(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  fileList: string[],
  onProcessed: () => void,
): Promise<FileScopeOutcome> {
  const { config, processor, logger } = deps;
  const method = scope === 'rules' ? 'processRulesUpdate' : 'processFile';
  const { processed, failed } = await processEach(
    fileList,
    (file) => processor[method](file),
    { concurrency: reindexConcurrency(config), logger, onProcessed },
  );
  return { filesProcessed: processed, failed };
}
