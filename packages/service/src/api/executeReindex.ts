/**
 * @module api/executeReindex
 * Shared reindex execution logic used by both the reindex handler and the triggerReindex lambda.
 */

import { access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { extractWatchPathStrings } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';
import { parallel } from 'radash';

import type { JeevesWatcherConfig } from '../config/types';
import { createIsGitignored, type GitignoreFilter } from '../gitignore';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { isPathWatched } from '../util/isPathWatched';
import { normalizeError } from '../util/normalizeError';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { retry } from '../util/retry';
import type { ValuesManager } from '../values';
import { normalizePathCase } from '../vcs/gitExec';
import type { ScrolledPoint, VectorStoreClient } from '../vectorStore';
import { listFilesFromGlobs, listFilesFromWatchRoots } from './fileScan';
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
 * `prune` is excluded - auto-pruning on config change is dangerous.
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
  queue?: EventQueue;
}

/** Blast area plan showing impact of a reindex operation. */
interface ReindexPlan {
  /** Total points (prune) or files (other scopes) examined. */
  total: number;
  /** Number of items to process (embed/re-apply rules). */
  toProcess: number;
  /** Number of points to delete (prune only, 0 for others). */
  toDelete: number;
  /** Counts grouped by watch root path. */
  byRoot: Record<string, number>;
  /** True when scroll was interrupted and results are partial. */
  incomplete?: boolean;
}

/** Result of a reindex execution. */
interface ExecuteReindexResult {
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
    const normalised = normalizeSlashes(fp);
    let matched = false;
    for (const root of watchPaths) {
      const rootNorm = normalizeSlashes(root).replace(/\/?\*\*.*$/, '');
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

/** Default page size for prune scroll (smaller than search to reduce connection strain). */
const PRUNE_SCROLL_PAGE_SIZE = 500;

/** Max retry attempts for scroll page failures. */
const SCROLL_RETRY_ATTEMPTS = 5;

/** Base delay for scroll retry backoff (ms). */
const SCROLL_RETRY_BASE_DELAY_MS = 1000;

/**
 * Scroll one page with retry/resume on connection failure.
 * On failure, retries with exponential backoff from the same cursor.
 */
async function scrollPageWithRetry(
  vectorStore: VectorStoreClient,
  cursor: string | number | undefined,
  logger: pino.Logger,
): Promise<{ points: ScrolledPoint[]; nextCursor?: string | number }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SCROLL_RETRY_ATTEMPTS; attempt++) {
    try {
      const page = await vectorStore.scrollPage(
        undefined,
        PRUNE_SCROLL_PAGE_SIZE,
        cursor,
        ['file_path'],
      );
      return { points: page.points, nextCursor: page.nextCursor };
    } catch (error) {
      lastError = error;
      if (attempt < SCROLL_RETRY_ATTEMPTS) {
        const delay =
          SCROLL_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) +
          Math.random() * 500;
        logger.warn(
          { attempt, err: normalizeError(error) },
          `Prune scroll page failed; retrying in ${String(Math.round(delay))}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/** Concurrency limit for fs.access() disk-existence checks. */
const FS_ACCESS_CONCURRENCY = 100;

/**
 * Compute the plan for a prune operation using a filter-first approach.
 *
 * 1. Enumerate all watched files from the filesystem → `watchedFiles` set.
 * 2. Scroll Qdrant points. For each point:
 *    - No `file_path` → orphan.
 *    - `file_path` not in `watchedFiles` → orphan (out of watch scope).
 *    - `file_path` in `watchedFiles` → check disk existence via `fs.access()`.
 *      If missing from disk → orphan (deleted file still in index).
 * 3. Batch `fs.access()` checks with bounded concurrency.
 */
async function computePrunePlan(
  deps: ExecuteReindexDeps,
): Promise<{ plan: ReindexPlan; orphanedIds: string[] }> {
  const { config, vectorStore, gitignoreFilter, logger } = deps;

  if (!vectorStore) {
    throw new Error('vectorStore is required for prune scope');
  }

  // Step 1: Build set of watched files from filesystem
  const isGitignored = createIsGitignored(gitignoreFilter);
  const watchedFileList = await listFilesFromGlobs(
    extractWatchPathStrings(config.watch.paths),
    config.watch.ignored,
    isGitignored,
  );
  const watchedFiles = new Set(
    watchedFileList.map((f) => normalizePathCase(normalizeSlashes(f))),
  );
  logger.info(
    { watchedFileCount: watchedFiles.size },
    'Prune: enumerated watched files from filesystem',
  );

  // Step 2: Scroll Qdrant and classify points
  const seenFiles = new Set<string>();
  const orphanedFiles = new Set<string>();
  const diskCheckFiles = new Set<string>();
  const orphanedIds: string[] = [];
  // Map from file_path → point IDs, for points needing disk-existence check
  const diskCheckPointIds = new Map<string, string[]>();
  let totalPoints = 0;
  let incomplete = false;
  let cursor: string | number | undefined;

  try {
    let hasMore = true;
    while (hasMore) {
      const page = await scrollPageWithRetry(vectorStore, cursor, logger);

      for (const point of page.points) {
        totalPoints++;
        const filePath = point.payload.file_path as string | undefined;
        if (!filePath) {
          orphanedIds.push(point.id);
          continue;
        }

        const normalized = normalizePathCase(normalizeSlashes(filePath));

        if (seenFiles.has(normalized)) {
          if (orphanedFiles.has(normalized)) {
            orphanedIds.push(point.id);
          } else if (diskCheckFiles.has(normalized)) {
            // Already queued for disk check — track its ID
            const ids = diskCheckPointIds.get(normalized);
            if (ids) ids.push(point.id);
          }
          continue;
        }

        seenFiles.add(normalized);

        if (!watchedFiles.has(normalized)) {
          // Not in watch scope → definitely orphaned
          orphanedFiles.add(normalized);
          orphanedIds.push(point.id);
        } else {
          // In watch scope → needs disk-existence check
          diskCheckFiles.add(normalized);
          diskCheckPointIds.set(normalized, [point.id]);
        }
      }

      // Progress logging every 100K points
      if (totalPoints > 0 && totalPoints % 100000 === 0) {
        logger.info(
          { totalPoints, orphanedCount: orphanedIds.length },
          'Prune scroll progress',
        );
      }

      if (!page.nextCursor) {
        hasMore = false;
      } else {
        cursor = page.nextCursor;
      }
    }
  } catch (error) {
    logger.error(
      { err: normalizeError(error), totalPoints, cursor },
      'Prune scroll failed after retries; returning partial plan',
    );
    incomplete = true;
  }

  // Step 3: Batch fs.access() checks for files in watch scope
  const filesToCheck = [...diskCheckFiles];
  await parallel(FS_ACCESS_CONCURRENCY, filesToCheck, async (filePath) => {
    try {
      await access(filePath);
    } catch {
      // File doesn't exist on disk → orphaned
      orphanedFiles.add(filePath);
      const pointIds = diskCheckPointIds.get(filePath);
      if (pointIds) {
        orphanedIds.push(...pointIds);
      }
    }
  });

  const orphanedFileList = [...orphanedFiles];
  const byRoot = groupByRoot(
    orphanedFileList,
    extractWatchPathStrings(config.watch.paths),
  );

  return {
    plan: {
      total: totalPoints,
      toProcess: 0,
      toDelete: orphanedIds.length,
      byRoot,
      ...(incomplete ? { incomplete: true } : {}),
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
  path?: string | string[],
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
  const isGitignored = createIsGitignored(gitignoreFilter);

  if (!VALID_REINDEX_SCOPES.includes(scope)) {
    throw new Error(
      `Invalid reindex scope: "${scope}". Valid scopes: ${VALID_REINDEX_SCOPES.join(', ')}`,
    );
  }

  const pathArray: string[] | undefined = path
    ? Array.isArray(path)
      ? path
      : [path]
    : undefined;

  if (scope === 'path' && (!pathArray || pathArray.length === 0)) {
    throw new Error('The "path" parameter is required when scope is "path".');
  }

  if (scope === 'prune' && !deps.vectorStore) {
    throw new Error('vectorStore is required for prune scope.');
  }

  // Compute plan before starting async work
  let plan: ReindexPlan | undefined;

  if (scope === 'prune') {
    deps.queue?.pause();
    await deps.queue?.waitForIdleWorkers();
    let pruneResult;
    try {
      pruneResult = await computePrunePlan(deps);
    } catch (err) {
      deps.queue?.resume();
      throw err;
    }
    plan = pruneResult.plan;

    if (dryRun) {
      deps.queue?.resume();
      return { filesProcessed: 0, durationMs: 0, errors: 0, plan };
    }

    // Abort live prune when plan is incomplete — never silently delete partial data
    if (plan.incomplete) {
      deps.queue?.resume();
      logger.error(
        { totalPoints: plan.total, pointsToDelete: plan.toDelete },
        'Aborting live prune — scroll was incomplete; partial deletes are unsafe',
      );
      return { filesProcessed: 0, durationMs: 0, errors: 1, plan };
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
    } finally {
      deps.queue?.resume();
    }
  }

  // Non-prune scopes: compute plan from file lists
  let fileList: string[] | undefined;

  if (scope === 'issues' && deps.issuesManager) {
    const issues = deps.issuesManager.getAll();
    fileList = Object.keys(issues);
  } else if (scope === 'path' && pathArray) {
    // Path plan computed inline in the execution block below
    fileList = undefined;
  } else if (scope === 'rules' && pathArray && pathArray.length > 0) {
    // Rules scope with path filter: list from watch roots intersected with caller globs
    fileList = await listFilesFromWatchRoots(
      extractWatchPathStrings(config.watch.paths),
      config.watch.ignored,
      pathArray,
      isGitignored,
    );
  } else {
    // rules or full: list files from globs
    fileList = await listFilesFromGlobs(
      extractWatchPathStrings(config.watch.paths),
      config.watch.ignored,
      isGitignored,
    );
  }

  if (fileList !== undefined) {
    plan = {
      total: fileList.length,
      toProcess: fileList.length,
      toDelete: 0,
      byRoot: groupByRoot(
        fileList,
        extractWatchPathStrings(config.watch.paths),
      ),
    };
  }

  if (dryRun) {
    // For path scope without pre-computed plan, compute it now
    if (plan === undefined && scope === 'path' && pathArray) {
      const pathFiles = await collectPathFiles(
        pathArray,
        config,
        deps.gitignoreFilter,
      );
      plan = {
        total: pathFiles.length,
        toProcess: pathFiles.length,
        toDelete: 0,
        byRoot: groupByRoot(
          pathFiles,
          extractWatchPathStrings(config.watch.paths),
        ),
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
        extractWatchPathStrings(config.watch.paths),
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
    } else if (scope === 'path' && pathArray) {
      const uniqueFiles = await collectPathFiles(
        pathArray,
        config,
        deps.gitignoreFilter,
      );

      plan = {
        total: uniqueFiles.length,
        toProcess: uniqueFiles.length,
        toDelete: 0,
        byRoot: groupByRoot(
          uniqueFiles,
          extractWatchPathStrings(config.watch.paths),
        ),
      };

      reindexTracker?.setTotal(uniqueFiles.length);

      await parallel(concurrency, uniqueFiles, async (filePath) => {
        await processor.processFile(filePath);
        reindexTracker?.incrementProcessed();
        filesProcessed++;
      });
    } else {
      // Full reindex
      filesProcessed = await processAllFiles(
        extractWatchPathStrings(config.watch.paths),
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
 * Collect and deduplicate files for a path-scoped reindex.
 *
 * Iterates over each target path, resolves its file list, and returns a
 * deduplicated array. This eliminates the duplicate iteration + `new Set()`
 * that previously appeared in both the dryRun plan and execution branches.
 */
async function collectPathFiles(
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
