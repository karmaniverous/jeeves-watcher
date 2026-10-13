/**
 * @module app/sources
 * Startup wiring for source documents: builds the source callback client from `sources` config (read at startup only) and the notify queue over the processor's source operations. No I/O.
 */

import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { hasSourceOperations } from '../processor/SourceOperations';
import type { DocumentProcessorInterface } from '../processor/types';
import {
  SourceNotifyQueue,
  type SourceProcess,
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

/** Stand-in used when a (custom) processor has no source operations. */
const unsupportedProcessor: SourceProcess = {
  process: (ref) =>
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
 * not started: call `start()` alongside the filesystem watcher. Each run
 * uses the processor's source operations as of that run (current rules); a
 * processor without source operations (the same test the API uses) fails
 * every run with `source_unavailable`.
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
  const runner: SourceProcess = hasSourceOperations(processor)
    ? {
        process: (ref, rule, options) =>
          processor.sourceOperations().process(ref, rule, options),
      }
    : unsupportedProcessor;
  return new SourceNotifyQueue(runner, { concurrency }, logger, issues);
}
