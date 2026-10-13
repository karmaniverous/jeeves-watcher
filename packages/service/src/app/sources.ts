/**
 * @module app/sources
 * Startup wiring for source documents: builds the source callback client from `sources` config (read at startup only) and the notify queue over the processor. No I/O.
 */

import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type {
  DocumentProcessorInterface,
  SourceProcessorInterface,
} from '../processor/types';
import {
  SourceNotifyQueue,
  type SourceQueueIssues,
} from '../queue/SourceNotifyQueue';
import { SourceClient, type SourceRetriever } from '../sources';

/**
 * Create the source callback client, once, from the startup config.
 * `sources` changes take effect on restart (as for `api.apiKey`).
 *
 * @param config - The startup configuration.
 * @returns A {@link SourceClient}, or `undefined` when no sources are configured.
 */
export function createSourceRetriever(
  config: JeevesWatcherConfig,
): SourceRetriever | undefined {
  const { sources } = config;
  if (!sources || Object.keys(sources).length === 0) return undefined;
  return new SourceClient(sources);
}

/**
 * Whether a processor can process source documents.
 *
 * @param processor - The document processor (possibly a test double).
 * @returns `true` when it implements {@link SourceProcessorInterface}.
 */
export function isSourceProcessor(
  processor: DocumentProcessorInterface,
): processor is DocumentProcessorInterface & SourceProcessorInterface {
  return (
    typeof (processor as Partial<SourceProcessorInterface>).processSource ===
    'function'
  );
}

/** Stand-in used when a (custom) processor cannot process sources. */
const unsupportedProcessor: SourceProcessorInterface = {
  processSource: (ref) =>
    Promise.resolve({
      source: ref,
      status: 'failed',
      error: {
        code: 'source_unavailable',
        message: 'The document processor does not support source documents',
      },
    }),
};

/**
 * Create the source notify queue (always, so the API can depend on it; it
 * is idle when nothing is notified). The caller passes the resolved
 * `embedding.concurrency`, shared with the file event queue. The queue is
 * not started: call `start()` alongside the filesystem watcher.
 *
 * @param processor - The document processor.
 * @param concurrency - Runs in flight at once (resolved embedding concurrency).
 * @param logger - Logger for unexpected run failures.
 * @param issues - Issues store for unexpected run failures.
 * @returns The (unstarted) queue.
 */
export function createNotifyQueue(
  processor: DocumentProcessorInterface,
  concurrency: number,
  logger: pino.Logger,
  issues?: SourceQueueIssues,
): SourceNotifyQueue {
  return new SourceNotifyQueue(
    isSourceProcessor(processor) ? processor : unsupportedProcessor,
    { concurrency },
    logger,
    issues,
  );
}
