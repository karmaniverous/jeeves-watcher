/**
 * @module api/executeReindex
 * Shared reindex execution logic used by both the config-reindex handler and the triggerReindex lambda.
 */

import type pino from 'pino';
import { parallel } from 'radash';

import type { JeevesWatcherConfig } from '../config/types';
import type { DocumentProcessorInterface } from '../processor';
import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';
import type { ValuesManager } from '../values';
import { processAllFiles } from './processAllFiles';
import type { ReindexTracker } from './ReindexTracker';

/** Dependencies for executeReindex. */
export interface ExecuteReindexDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  reindexTracker?: ReindexTracker;
  valuesManager?: ValuesManager;
  issuesManager?: { getAll: () => Record<string, unknown> };
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
 * Execute a reindex operation: process all files, track progress, and fire callback if configured.
 *
 * @param deps - Dependencies.
 * @param scope - 'issues' for reprocessing files with errors, 'full' for full reprocessing.
 * @returns The reindex result.
 */
export async function executeReindex(
  deps: ExecuteReindexDeps,
  scope: 'issues' | 'full',
): Promise<ExecuteReindexResult> {
  const { config, processor, logger, reindexTracker, valuesManager } = deps;

  reindexTracker?.start(scope);

  const startTime = Date.now();
  let filesProcessed = 0;
  let errors = 0;

  try {
    if (scope === 'full' && valuesManager) {
      valuesManager.clearAll();
    }

    if (scope === 'issues' && deps.issuesManager) {
      // Reprocess only files with issues
      const issues = deps.issuesManager.getAll();
      const issuePaths = Object.keys(issues);
      const concurrency = config.reindex?.concurrency ?? 50;
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
    } else {
      // Full reindex - process all watched files
      const concurrency = config.reindex?.concurrency ?? 50;
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
