/**
 * @module api/executeReindex
 * Shared reindex execution logic used by both the config-reindex handler and the triggerReindex lambda.
 */

import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { DocumentProcessor } from '../processor';
import { normalizeError } from '../util/normalizeError';
import type { ValuesManager } from '../values';
import { processAllFiles } from './processAllFiles';
import type { ReindexTracker } from './ReindexTracker';

/** Dependencies for executeReindex. */
export interface ExecuteReindexDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessor;
  logger: pino.Logger;
  reindexTracker?: ReindexTracker;
  valuesManager?: ValuesManager;
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
  const maxAttempts = 3;
  let delayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) return;
      logger.warn(
        { attempt, status: response.status, url },
        'Reindex callback non-OK response',
      );
    } catch (error) {
      logger.warn(
        { attempt, err: normalizeError(error), url },
        'Reindex callback failed',
      );
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
  logger.error({ url }, 'Reindex callback exhausted all retry attempts');
}

/**
 * Execute a reindex operation: process all files, track progress, and fire callback if configured.
 *
 * @param deps - Dependencies.
 * @param scope - 'rules' for rules-only reindex, 'full' for full reprocessing.
 * @returns The reindex result.
 */
export async function executeReindex(
  deps: ExecuteReindexDeps,
  scope: 'rules' | 'full',
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

    const method = scope === 'rules' ? 'processRulesUpdate' : 'processFile';
    filesProcessed = await processAllFiles(
      config.watch.paths,
      config.watch.ignored,
      processor,
      method,
    );

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
