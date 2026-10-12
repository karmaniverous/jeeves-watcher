/**
 * @module api/reindexFileScopes
 * File side of reindex scopes `issues`, `full`, `rules` and `path`: lists the scope's files, builds the per-root plan, and processes them with bounded concurrency. fs I/O plus processor calls.
 */

import {
  extractWatchPathStrings,
  type ReindexScope,
} from '@karmaniverous/jeeves-watcher-core';
import { parallel } from 'radash';

import type { JeevesWatcherConfig } from '../config/types';
import { createIsGitignored } from '../gitignore';
import { isSourceReference } from '../util/documentKey';
import { normalizeError } from '../util/normalizeError';
import { listFilesFromGlobs, listFilesFromWatchRoots } from './fileScan';
import { processAllFiles } from './processAllFiles';
import { collectPathFiles } from './reindexPathFiles';
import { groupByRoot, type ReindexPlan } from './reindexPlan';
import type { ExecuteReindexDeps } from './reindexTypes';

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
 * List the files of a non-prune scope before execution. Scope `path` is
 * resolved separately ({@link collectPathFiles}) and yields `undefined`.
 *
 * - `issues`: the file-path keys of the issues store (when present).
 * - `rules` with paths: watch roots intersected with the caller's globs.
 * - otherwise: every watched file.
 *
 * @param deps - Reindex dependencies.
 * @param scope - Reindex scope (not `prune`).
 * @param pathArray - Target paths/globs (`path` and `rules` scopes).
 * @returns The scope's files, or `undefined` for scope `path`.
 */
export async function listScopeFiles(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  pathArray: string[] | undefined,
): Promise<string[] | undefined> {
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
    // Path plan computed from collectPathFiles.
    return undefined;
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
  /** Files processed. */
  filesProcessed: number;
  /** Files whose processing threw (scope `issues` only). */
  errors: number;
}

/** Progress hooks for {@link runFileScope}. */
export interface FileScopeProgress {
  /** Called once with the number of files about to be processed. */
  onTotal: (total: number) => void;
  /** Called after each processed file. */
  onProcessed: () => void;
  /** Called with the plan resolved during execution (scope `path` only). */
  onPlan: (plan: ReindexPlan) => void;
}

/**
 * Process the files of a non-prune scope.
 *
 * @param deps - Reindex dependencies.
 * @param scope - Reindex scope (not `prune`).
 * @param pathArray - Target paths/globs (`path` and `rules` scopes).
 * @param fileList - Files from {@link listScopeFiles}.
 * @param progress - Progress hooks.
 * @returns Files processed and errors.
 */
export async function runFileScope(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  pathArray: string[] | undefined,
  fileList: string[] | undefined,
  progress: FileScopeProgress,
): Promise<FileScopeOutcome> {
  const { config, processor, logger } = deps;
  const isGitignored = createIsGitignored(deps.gitignoreFilter);
  const watchPaths = extractWatchPathStrings(config.watch.paths);
  const concurrency = config.reindex?.concurrency ?? 50;
  const callbacks = {
    onTotal: progress.onTotal,
    onFileProcessed: progress.onProcessed,
  };

  if (scope === 'issues' && fileList) {
    let filesProcessed = 0;
    let errors = 0;
    await parallel(concurrency, fileList, async (filePath) => {
      try {
        await processor.processFile(filePath);
        filesProcessed++;
      } catch (error) {
        errors++;
        logger.warn(
          { filePath, err: normalizeError(error) },
          'Failed to reprocess issue file',
        );
      }
    });
    return { filesProcessed, errors };
  }

  if (scope === 'rules') {
    const filesProcessed = await processAllFiles(
      watchPaths,
      config.watch.ignored,
      processor,
      'processRulesUpdate',
      concurrency,
      callbacks,
      isGitignored,
      fileList,
    );
    return { filesProcessed, errors: 0 };
  }

  if (scope === 'path' && pathArray) {
    const uniqueFiles = await collectPathFiles(
      pathArray,
      config,
      deps.gitignoreFilter,
    );
    progress.onPlan(filePlan(uniqueFiles, config));
    progress.onTotal(uniqueFiles.length);
    let filesProcessed = 0;
    await parallel(concurrency, uniqueFiles, async (filePath) => {
      await processor.processFile(filePath);
      progress.onProcessed();
      filesProcessed++;
    });
    return { filesProcessed, errors: 0 };
  }

  // Full reindex
  const filesProcessed = await processAllFiles(
    watchPaths,
    config.watch.ignored,
    processor,
    'processFile',
    concurrency,
    callbacks,
    isGitignored,
    fileList,
  );
  return { filesProcessed, errors: 0 };
}
