/**
 * @module queue/sourceNotifyTypes
 * Options, errors and job bookkeeping types of the source notify queue (validated options schema, stopped error, coalesced jobs and their waiters). No I/O.
 */

import {
  type DocumentResult,
  EMBEDDING_DEFAULTS,
} from '@karmaniverous/jeeves-watcher-core';
import { z } from 'zod';

import type { IssuesManager } from '../issues';

/**
 * Default number of references processed at once: the core
 * `embedding.concurrency` default, which the service passes in.
 */
export const DEFAULT_SOURCE_NOTIFY_CONCURRENCY = EMBEDDING_DEFAULTS.concurrency;

/** Options for the source notify queue. */
export const sourceNotifyQueueOptionsSchema = z.object({
  /** Maximum number of references processed concurrently. */
  concurrency: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_SOURCE_NOTIFY_CONCURRENCY),
});

/** Options for the source notify queue (input form; defaults applied). */
export type SourceNotifyQueueOptions = z.input<
  typeof sourceNotifyQueueOptionsSchema
>;

/** Issues-store operations the queue needs. */
export type SourceQueueIssues = Pick<IssuesManager, 'record' | 'clear'>;

/** Per-run options of `SourceNotifyQueue.processNow`. */
export interface ProcessNowOptions {
  /**
   * Re-embed even when content is unchanged (reindex scope `full`). Merged
   * as OR into a run it joins.
   */
  force?: boolean;
}

/** Rejection for `SourceNotifyQueue.processNow` after `stop()`. */
export class SourceNotifyQueueStoppedError extends Error {
  /** Create the error. */
  constructor() {
    super('Source notify queue is stopped');
    this.name = 'SourceNotifyQueueStoppedError';
  }
}

/** A caller waiting for a run's result. */
export interface Waiter {
  /** Receives the run's result. */
  resolve: (result: DocumentResult) => void;
  /** Receives the stop error when the run is dropped. */
  reject: (error: Error) => void;
}

/** One scheduled run of a reference: the latest rule, `force` (OR) and its waiters. */
export interface Job {
  /** The exact reference. */
  ref: string;
  /** Latest designated rule. */
  rule: string;
  /** Re-embed unchanged content (OR of every merged request). */
  force: boolean;
  /** Callers waiting for this run. */
  waiters: Waiter[];
}

/** An in-flight reference; `dirty` is the single run owed after it. */
export interface InFlight {
  /** The run owed after the current one, if any. */
  dirty?: Job;
}

/**
 * Reject and drop every waiter of a job.
 *
 * @param job - The dropped job.
 * @param error - The rejection.
 */
export function rejectAll(job: Job, error: Error): void {
  for (const waiter of job.waiters) waiter.reject(error);
  job.waiters = [];
}
