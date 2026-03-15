/**
 * @module api/executeReindex
 * Shared reindex execution logic used by both the config-reindex handler and the triggerReindex lambda.
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type pino from 'pino';
import { parallel } from 'radash';

import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import type { DocumentProcessorInterface } from '../processor';
import { isPathWatched } from '../util/isPathWatched';
import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { listFilesFromGlobs } from './fileScan';
import { processAllFiles } from './processAllFiles';
import type { ReindexTracker } from './ReindexTracker';

/** Valid reindex scopes. */
export type ReindexScope = 'issues' | 'full' | 'rules' | 'path' | 'prune';

/** Ordered list of valid reindex scopes for validation. */
export const VALID_REINDEX_SCOPES: readonly ReindexScope[] = [
  'issues',
  'full',
  'rules',
  'path',
  'prune',
] as const;

/**
 * Valid scopes for config-watch auto-trigger.
 * `prune` is excluded — auto-pruning on config change is dangerous.
 */
export const CONFIG_WATCH_VALID_SCOPES: readonly ReindexScope[] = [
  'issues',
  'full',
  'rules',
] as const;

/** Dependencies for executeReindex. */
export interface ExecuteReindexDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  reindexTracker?: ReindexTracker;
  valuesManager?: ValuesManager;
  issuesManager?: { getAll: () => Record<string, unknown> };
  gitignoreFilter?: GitignoreFilter;
  vectorStore?: VectorStoreClient;
}

/** Blast area plan showing impact of a reindex operation. */
export interface ReindexPlan {
  /** Total points (prune) or files (other scopes) examined. */
  total: number;
  /** Number of items to process (embed/re-apply rules). */
  toProcess: number;
  /** Number of points to delete (prune only, 0 for others). */
  toDelete: number;
  /** Counts grouped by watch root path. */
  byRoot: Record<string, number>;
}

/** Result of a reindex execution. */
export interface ExecuteReindexResult {
  filesProcessed: number;
  durationMs: number;
  errors: number;
  plan?: ReindexPlan;
}

/** Fire reindex callback with exponential backoff retry. */
async function fireCallback(
  url: string,
  payload: Record<string, unknown>,
  logger: pino.Logger,
): Promise<void> {
  await retry(
    async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Non-OK response: ${String(response.status)}`);
      }
    },
    {
      attempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 4000,
      onRetry: ({ attempt, error }) => {
        logger.warn(
          { attempt, err: normalizeError(error), url },
          'Reindex callback failed; will retry',
        );
      },
    },
  );
}

/**
 * Group file paths by their watch root prefix.
 * Each file is matched against `watchPaths` and grouped under the first matching root.
 * Files that don't match any root are grouped under `'(unmatched)'`.
 */
function groupByRoot(
  filePaths: string[],
  watchPaths: string[],
): Record<string, number> {
  const byRoot: Record<string, number> = {};
  for (const fp of filePaths) {
    const normalised = fp.replace(/\\/g, '/');
    let matched = false;
    for (const root of watchPaths) {
      const rootNorm = root.replace(/\\/g, '/').replace(/\/?\*\*.*$/, '');
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

/**
 * Compute the plan for a prune operation.
 * Scrolls all Qdrant points, checks each file_path against watch scope + gitignore,
 * returns the list of orphaned point IDs and the plan.
 */
async function computePrunePlan(
  deps: ExecuteReindexDeps,
): Promise<{ plan: ReindexPlan; orphanedIds: string[] }> {
  const { config, vectorStore, gitignoreFilter } = deps;

  if (!vectorStore) {
    throw new Error('vectorStore is required for prune scope');
  }

  const seenFiles = new Set<string>();
  const orphanedFiles = new Set<string>();
  const orphanedIds: string[] = [];
  let totalPoints = 0;

  for await (const point of vectorStore.scroll(undefined, 1000)) {
    totalPoints++;
    const filePath = point.payload.file_path as string | undefined;
    if (!filePath) {
      orphanedIds.push(point.id);
      continue;
    }

    if (seenFiles.has(filePath)) {
      // Already classified this file
      if (orphanedFiles.has(filePath)) {
        orphanedIds.push(point.id);
      }
      continue;
    }

    seenFiles.add(filePath);

    const watched = isPathWatched(
      filePath,
      config.watch.paths,
      config.watch.ignored,
    );
    const gitignored = gitignoreFilter
      ? gitignoreFilter.isIgnored(filePath)
      : false;

    if (!watched || gitignored) {
      orphanedFiles.add(filePath);
      orphanedIds.push(point.id);
    }
  }

  const orphanedFileList = [...orphanedFiles];
  const byRoot = groupByRoot(orphanedFileList, config.watch.paths);

  return {
    plan: {
      total: totalPoints,
      toProcess: 0,
      toDelete: orphanedIds.length,
      byRoot,
    },
    orphanedIds,
  };
}

/**
 * Execute a reindex operation: process files, track progress, and fire callback if configured.
 *
 * @param deps - Dependencies.
 * @param scope - Reindex scope: 'issues', 'full', 'rules', 'path', or 'prune'.
 * @param path - Target path (required when scope is 'path').
 * @param dryRun - When true, compute and return the plan without executing.
 * @returns The reindex result including the blast area plan.
 */
export async function executeReindex(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  path?: string,
  dryRun: boolean = false,
): Promise<ExecuteReindexResult> {
  const {
    config,
    processor,
    logger,
    reindexTracker,
    valuesManager,
    gitignoreFilter,
  } = deps;
  const isGitignored = gitignoreFilter
    ? (filePath: string) => gitignoreFilter.isIgnored(filePath)
    : undefined;

  if (!VALID_REINDEX_SCOPES.includes(scope)) {
    throw new Error(
      `Invalid reindex scope: "${scope}". Valid scopes: ${VALID_REINDEX_SCOPES.join(', ')}`,
    );
  }

  if (scope === 'path' && !path) {
    throw new Error('The "path" parameter is required when scope is "path".');
  }

  if (scope === 'prune' && !deps.vectorStore) {
    throw new Error('vectorStore is required for prune scope.');
  }

  // Compute plan before starting async work
  let plan: ReindexPlan | undefined;

  if (scope === 'prune') {
    const pruneResult = await computePrunePlan(deps);
    plan = pruneResult.plan;

    if (dryRun) {
      return { filesProcessed: 0, durationMs: 0, errors: 0, plan };
    }

    // Execute prune
    reindexTracker?.start(scope);
    const startTime = Date.now();

    try {
      if (pruneResult.orphanedIds.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < pruneResult.orphanedIds.length; i += batchSize) {
          const batch = pruneResult.orphanedIds.slice(i, i + batchSize);
          await deps.vectorStore!.delete(batch);
        }
      }

      const durationMs = Date.now() - startTime;
      logger.info(
        { scope, pointsDeleted: pruneResult.orphanedIds.length, durationMs },
        `Reindex (prune) completed`,
      );

      reindexTracker?.complete();

      if (config.reindex?.callbackUrl) {
        await fireCallback(
          config.reindex.callbackUrl,
          {
            scope,
            filesProcessed: 0,
            durationMs,
            pointsDeleted: pruneResult.orphanedIds.length,
            errors: [],
          },
          logger,
        );
      }

      return {
        filesProcessed: 0,
        durationMs,
        errors: 0,
        plan,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error({ err: normalizeError(error), scope }, 'Prune failed');
      reindexTracker?.complete();

      if (config.reindex?.callbackUrl) {
        await fireCallback(
          config.reindex.callbackUrl,
          {
            scope,
            filesProcessed: 0,
            durationMs,
            errors: [normalizeError(error).message],
          },
          logger,
        );
      }

      return { filesProcessed: 0, durationMs, errors: 1, plan };
    }
  }

  // Non-prune scopes: compute plan from file lists
  let fileList: string[] | undefined;

  if (scope === 'issues' && deps.issuesManager) {
    const issues = deps.issuesManager.getAll();
    fileList = Object.keys(issues);
  } else if (scope === 'path' && path) {
    // Path plan computed inside executePathReindex — skip pre-computation for now
    fileList = undefined;
  } else {
    // rules or full: list files from globs
    fileList = await listFilesFromGlobs(
      config.watch.paths,
      config.watch.ignored,
      isGitignored,
    );
  }

  if (fileList !== undefined) {
    plan = {
      total: fileList.length,
      toProcess: fileList.length,
      toDelete: 0,
      byRoot: groupByRoot(fileList, config.watch.paths),
    };
  }

  if (dryRun) {
    // For path scope without pre-computed plan, compute it now
    if (plan === undefined && scope === 'path' && path) {
      const pathFiles = await getPathFileList(
        path,
        config,
        deps.gitignoreFilter,
      );
      plan = {
        total: pathFiles.length,
        toProcess: pathFiles.length,
        toDelete: 0,
        byRoot: groupByRoot(pathFiles, config.watch.paths),
      };
    }
    return { filesProcessed: 0, durationMs: 0, errors: 0, plan };
  }

  reindexTracker?.start(scope);

  const startTime = Date.now();
  let filesProcessed = 0;
  let errors = 0;
  const concurrency = config.reindex?.concurrency ?? 50;

  try {
    if (scope === 'full' && valuesManager) {
      valuesManager.clearAll();
    }

    if (scope === 'issues' && fileList) {
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
    } else if (scope === 'rules') {
      filesProcessed = await processAllFiles(
        config.watch.paths,
        config.watch.ignored,
        processor,
        'processRulesUpdate',
        concurrency,
        {
          onTotal: (total) => reindexTracker?.setTotal(total),
          onFileProcessed: () => reindexTracker?.incrementProcessed(),
        },
        isGitignored,
        fileList,
      );
    } else if (scope === 'path' && path) {
      const pathResult = await executePathReindex(
        path,
        config,
        processor,
        logger,
        deps.gitignoreFilter,
        concurrency,
        reindexTracker,
      );
      filesProcessed = pathResult.filesProcessed;
      if (!plan) {
        plan = pathResult.plan;
      }
    } else {
      // Full reindex
      filesProcessed = await processAllFiles(
        config.watch.paths,
        config.watch.ignored,
        processor,
        'processFile',
        concurrency,
        {
          onTotal: (total) => reindexTracker?.setTotal(total),
          onFileProcessed: () => reindexTracker?.incrementProcessed(),
        },
        isGitignored,
        fileList,
      );
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      { scope, filesProcessed, durationMs },
      `Reindex (${scope}) completed`,
    );

    reindexTracker?.complete();

    if (config.reindex?.callbackUrl) {
      await fireCallback(
        config.reindex.callbackUrl,
        { scope, filesProcessed, durationMs, errors: [] },
        logger,
      );
    }

    return { filesProcessed, durationMs, errors, plan };
  } catch (error) {
    errors = 1;
    const durationMs = Date.now() - startTime;
    logger.error({ err: normalizeError(error), scope }, 'Reindex failed');

    reindexTracker?.complete();

    if (config.reindex?.callbackUrl) {
      await fireCallback(
        config.reindex.callbackUrl,
        {
          scope,
          filesProcessed: 0,
          durationMs,
          errors: [normalizeError(error).message],
        },
        logger,
      );
    }

    return { filesProcessed: 0, durationMs, errors, plan };
  }
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
    config.watch.paths,
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
    const isGitignored = gitignoreFilter
      ? (filePath: string) => gitignoreFilter.isIgnored(filePath)
      : undefined;
    const allWatchedFiles = await listFilesFromGlobs(
      config.watch.paths,
      config.watch.ignored,
      isGitignored,
    );
    const targetAbsPath = resolve(targetPath);
    return allWatchedFiles.filter((f) => resolve(f).startsWith(targetAbsPath));
  }

  throw new Error(`Path is neither a file nor a directory: ${targetPath}`);
}

/** Result of a path-scoped reindex. */
interface PathReindexResult {
  filesProcessed: number;
  plan: ReindexPlan;
}

/**
 * Execute a path-scoped reindex: process a single file or all files under a directory.
 * Validates path against watch scope and gitignore.
 */
async function executePathReindex(
  targetPath: string,
  config: JeevesWatcherConfig,
  processor: DocumentProcessorInterface,
  logger: pino.Logger,
  gitignoreFilter: GitignoreFilter | undefined,
  concurrency: number,
  reindexTracker: ReindexTracker | undefined,
): Promise<PathReindexResult> {
  const filesInScope = await getPathFileList(
    targetPath,
    config,
    gitignoreFilter,
  );

  const plan: ReindexPlan = {
    total: filesInScope.length,
    toProcess: filesInScope.length,
    toDelete: 0,
    byRoot: groupByRoot(filesInScope, config.watch.paths),
  };

  if (filesInScope.length === 0) {
    logger.info(
      { targetPath },
      'Path reindex: no matched files found in directory',
    );
    return { filesProcessed: 0, plan };
  }

  reindexTracker?.setTotal(filesInScope.length);

  let processedCount = 0;
  await parallel(concurrency, filesInScope, async (filePath) => {
    await processor.processFile(filePath);
    reindexTracker?.incrementProcessed();
    processedCount++;
  });

  return { filesProcessed: processedCount, plan };
}
