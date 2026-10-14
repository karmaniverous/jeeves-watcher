/**
 * @module api/reindexWork
 * Bounded-concurrency reindex work with one error policy: the configured `reindex.concurrency` (core default) and `processEach`, which attempts every item, logs and collects failures, and reports progress after each item. No I/O of its own.
 */

import { REINDEX_DEFAULTS } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';
import { parallel } from 'radash';

import type { JeevesWatcherConfig } from '../config/types';
import { normalizeError } from '../util/normalizeError';

/**
 * Items a reindex works on at once: `reindex.concurrency`, else the core
 * default ({@link REINDEX_DEFAULTS}). The only service-side fallback.
 *
 * @param config - Service config.
 * @returns The concurrency.
 */
export function reindexConcurrency(config: JeevesWatcherConfig): number {
  return config.reindex?.concurrency ?? REINDEX_DEFAULTS.concurrency;
}

/** Options of {@link processEach}. */
export interface ProcessEachOptions {
  /** Items in flight at once. */
  concurrency: number;
  /** Logger for item failures. */
  logger: pino.Logger;
  /** Called after each item, whether it succeeded or failed. */
  onProcessed?: () => void;
}

/** Outcome of {@link processEach}. */
export interface ProcessEachOutcome {
  /** Items whose run resolved. */
  processed: number;
  /** Items whose run threw, in completion order. */
  failed: string[];
}

/**
 * Run `work` on every item with bounded concurrency. Error policy (the same
 * for every reindex scope): a failing item is logged at `warn` and recorded
 * in `failed`; the remaining items still run, so one bad file never stops a
 * reindex.
 *
 * @param items - Items (file paths).
 * @param work - Work for one item.
 * @param options - Concurrency, logger and progress hook.
 * @returns Processed count and failed items.
 */
export async function processEach(
  items: readonly string[],
  work: (item: string) => Promise<unknown>,
  options: ProcessEachOptions,
): Promise<ProcessEachOutcome> {
  let processed = 0;
  const failed: string[] = [];
  await parallel(options.concurrency, [...items], async (item) => {
    try {
      await work(item);
      processed++;
    } catch (error) {
      failed.push(item);
      options.logger.warn(
        { filePath: item, err: normalizeError(error) },
        'Reindex failed for file',
      );
    }
    options.onProcessed?.();
  });
  return { processed, failed };
}
