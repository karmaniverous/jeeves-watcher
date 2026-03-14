/**
 * @module api/executeReindex
 * Shared reindex execution logic used by both the config-reindex handler and the triggerReindex lambda.
 */

import { stat } from 'node:fs/promises';

import type pino from 'pino';
import { parallel } from 'radash';

import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import type { DocumentProcessorInterface } from '../processor';
import { normalizeError } from '../util/normalizeError';
import { isPathWatched } from '../util/isPathWatched';
import { retry } from '../util/retry';
import type { ValuesManager } from '../values';
import { processAllFiles } from './processAllFiles';
import type { ReindexTracker } from './ReindexTracker';

/** Valid reindex scopes. */
export type ReindexScope = 'issues' | 'full' | 'rules' | 'path';

/** Ordered list of valid reindex scopes for validation. */
export const VALID_REINDEX_SCOPES: readonly ReindexScope[] = [
  'issues',
  'full',
  'rules',
  'path',
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
}

/** Result of a reindex execution. */
export interface ExecuteReindexResult {
  filesProcessed: number;
  durationMs: number;
  errors: number;
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
 * Execute a reindex operation: process files, track progress, and fire callback if configured.
 *
 * @param deps - Dependencies.
 * @param scope - Reindex scope: 'issues', 'full', 'rules', or 'path'.
 * @param path - Target path (required when scope is 'path').
 * @returns The reindex result.
 */
export async function executeReindex(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  path?: string,
): Promise<ExecuteReindexResult> {
  const { config, processor, logger, reindexTracker, valuesManager, gitignoreFilter } =
    deps;
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

  reindexTracker?.start(scope);

  const startTime = Date.now();
  let filesProcessed = 0;
  let errors = 0;
  const concurrency = config.reindex?.concurrency ?? 50;

  try {
    if (scope === 'full' && valuesManager) {
      valuesManager.clearAll();
    }

    if (scope === 'issues' && deps.issuesManager) {
      const issues = deps.issuesManager.getAll();
      const issuePaths = Object.keys(issues);
      await parallel(concurrency, issuePaths, async (filePath) => {
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
      );
    } else if (scope === 'path' && path) {
      filesProcessed = await executePathReindex(
        path,
        config,
        processor,
        logger,
        deps.gitignoreFilter,
        concurrency,
        reindexTracker,
      );
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

    return { filesProcessed, durationMs, errors };
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

    return { filesProcessed: 0, durationMs, errors };
  }
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
): Promise<number> {
  // Validate path is within watch scope
  const watched = isPathWatched(
    targetPath,
    config.watch.paths,
    config.watch.ignored,
  );
  if (!watched) {
    throw new Error(`Path is outside watch scope: ${targetPath}`);
  }

  // Check gitignore
  if (gitignoreFilter?.isIgnored(targetPath)) {
    throw new Error(`Path is gitignored: ${targetPath}`);
  }

  const stats = await stat(targetPath);

  if (stats.isFile()) {
    await processor.processFile(targetPath);
    reindexTracker?.setTotal(1);
    reindexTracker?.incrementProcessed();
    return 1;
  }

  if (stats.isDirectory()) {
    // Scope processAllFiles to this directory by creating a glob pattern
    const normalizedPath = targetPath.replace(/\\/g, '/').replace(/\/$/, '');
    const scopedPaths = config.watch.paths
      .map((p) => {
        const normalized = p.replace(/\\/g, '/');
        // If the watch glob covers this directory, use it scoped to the target
        if (normalized.startsWith(normalizedPath)) return p;
        // Extract the extension pattern from the glob and apply to target dir
        const extMatch = /\*\*\/\*\.(.+)$/.exec(normalized);
        if (extMatch) return `${normalizedPath}/**/*.${extMatch[1]}`;
        return null;
      })
      .filter((p): p is string => p !== null);

    if (scopedPaths.length === 0) {
      throw new Error(
        `No watch paths cover directory: ${targetPath}`,
      );
    }

    const isGitignored = gitignoreFilter
      ? (filePath: string) => gitignoreFilter.isIgnored(filePath)
      : undefined;

    return await processAllFiles(
      scopedPaths,
      config.watch.ignored,
      processor,
      'processFile',
      concurrency,
      {
        onTotal: (total) => reindexTracker?.setTotal(total),
        onFileProcessed: () => reindexTracker?.incrementProcessed(),
      },
      isGitignored,
    );
  }

  throw new Error(`Path is neither a file nor a directory: ${targetPath}`);
}
