/**
 * @module app/queues
 * Builds the file event queue and the source notify queue with one resolved embedding concurrency (computed once, shared by both). Neither queue is started. No I/O.
 */

import {
  EMBEDDING_DEFAULTS,
  WATCH_DEFAULTS,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { SourceOperationsProvider } from '../processor/SourceOperations';
import type { EventQueue } from '../queue';
import type {
  SourceNotifyQueue,
  SourceQueueIssues,
} from '../queue/SourceNotifyQueue';
import type { JeevesWatcherFactories } from './factories';
import { createNotifyQueue } from './sources';

/** The two work queues. */
export interface WatcherQueues {
  /** File event queue (debounced watcher events). */
  queue: EventQueue;
  /** Source notify queue. */
  sourceQueue: SourceNotifyQueue;
}

/**
 * Create both queues (unstarted) with the resolved `embedding.concurrency`.
 *
 * @param config - The startup config (`embedding.concurrency`, `watch.debounceMs`).
 * @param factories - Component factories (`createEventQueue`).
 * @param processor - The document processor.
 * @param sinks - Logger and issues store for unexpected source-run failures.
 * @returns The file and source queues.
 */
export function createQueues(
  config: JeevesWatcherConfig,
  factories: Pick<JeevesWatcherFactories, 'createEventQueue'>,
  processor: SourceOperationsProvider,
  sinks: { logger: pino.Logger; issues?: SourceQueueIssues },
): WatcherQueues {
  const concurrency =
    config.embedding.concurrency ?? EMBEDDING_DEFAULTS.concurrency;
  return {
    queue: factories.createEventQueue({
      debounceMs: config.watch.debounceMs ?? WATCH_DEFAULTS.debounceMs,
      concurrency,
    }),
    sourceQueue: createNotifyQueue(
      processor,
      concurrency,
      sinks.logger,
      sinks.issues,
    ),
  };
}
