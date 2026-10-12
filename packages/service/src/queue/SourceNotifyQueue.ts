/**
 * @module queue/SourceNotifyQueue
 * In-memory notify queue for source documents, keyed by reference: pending notifications merge, in-flight ones mark the reference dirty for exactly one re-run. Calls processSource; no direct I/O.
 */

import type { DocumentResult } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';
import { z } from 'zod';

import type { SourceProcessorInterface } from '../processor/types';
import { normalizeError } from '../util/normalizeError';
import type { PausableQueue } from './pausable';

/**
 * Default number of references processed at once. Matches the
 * `embedding.concurrency` default, which the service passes in.
 */
export const DEFAULT_SOURCE_NOTIFY_CONCURRENCY = 5;

/** Issue code reported when `processSource` rejects unexpectedly. */
const UNEXPECTED_ERROR_CODE = 'extraction_error';

/** Options for {@link SourceNotifyQueue}. */
export const sourceNotifyQueueOptionsSchema = z.object({
  /** Maximum number of references processed concurrently. */
  concurrency: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_SOURCE_NOTIFY_CONCURRENCY),
});

/** Options for {@link SourceNotifyQueue} (input form; defaults applied). */
export type SourceNotifyQueueOptions = z.input<
  typeof sourceNotifyQueueOptionsSchema
>;

/** Rejection for {@link SourceNotifyQueue.processNow} after {@link SourceNotifyQueue.stop}. */
export class SourceNotifyQueueStoppedError extends Error {
  /** Create the error. */
  constructor() {
    super('Source notify queue is stopped');
    this.name = 'SourceNotifyQueueStoppedError';
  }
}

interface Waiter {
  resolve: (result: DocumentResult) => void;
  reject: (error: Error) => void;
}

/** One scheduled run of a reference: the latest rule and its waiters. */
interface Job {
  ref: string;
  rule: string;
  waiters: Waiter[];
}

/** An in-flight reference; `dirty` is the single run owed after it. */
interface InFlight {
  dirty?: Job;
}

/**
 * Coalescing queue for source-document notifications (Decision 12).
 *
 * - A notification for a **pending** reference is merged into it (the latest
 *   rule wins; the reference keeps its place in line).
 * - One for an **in-flight** reference marks it dirty: when the current run
 *   ends the reference is queued once more (at the back), however many
 *   notifications arrived meanwhile.
 * - Every run calls `processSource`, which retrieves current state, so a
 *   burst on one reference costs at most two retrievals and the final state
 *   wins. Runs never overlap for the same reference.
 *
 * References are compared exactly (case-sensitive), like source point IDs.
 * The queue holds work until {@link start}; {@link pause} (prune) stops new
 * runs without rejecting enqueues. Failures never escape: `processSource`
 * records issues itself, and an unexpected rejection becomes a `failed`
 * result.
 */
export class SourceNotifyQueue implements PausableQueue {
  private readonly concurrency: number;
  private started = false;
  private paused = false;
  private stopped = false;

  private readonly pending = new Map<string, Job>();
  private readonly inFlight = new Map<string, InFlight>();

  private drainWaiters: Array<() => void> = [];
  private idleWaiters: Array<() => void> = [];

  /**
   * @param processor - Processes one reference with its designated rule.
   * @param options - Queue options (validated).
   * @param logger - Logger for unexpected processing rejections.
   */
  constructor(
    private readonly processor: SourceProcessorInterface,
    options: SourceNotifyQueueOptions = {},
    private readonly logger?: pino.Logger,
  ) {
    this.concurrency =
      sourceNotifyQueueOptionsSchema.parse(options).concurrency;
  }

  /**
   * Notify that a source document changed (fire and forget).
   *
   * @param ref - The exact `<name>://<id>` reference.
   * @param rule - The designated rule name.
   * @returns `false` when the queue is stopped and the notification was dropped.
   */
  enqueue(ref: string, rule: string): boolean {
    if (this.stopped) return false;
    this.schedule(ref, rule);
    this.pump();
    return true;
  }

  /**
   * Process a reference and resolve with the result of a run that started
   * after this call, so the result reflects the source's state at or after
   * the call (the `?wait=true` path). Coalesces with other notifications:
   * if the reference is pending, this joins that run; if it is in flight,
   * this waits for the current run and then the one dirty re-run.
   *
   * @param ref - The exact `<name>://<id>` reference.
   * @param rule - The designated rule name.
   * @returns The per-document result.
   * @throws {@link SourceNotifyQueueStoppedError} (as a rejection) when the
   *   queue is stopped before the run starts.
   */
  processNow(ref: string, rule: string): Promise<DocumentResult> {
    if (this.stopped) {
      return Promise.reject(new SourceNotifyQueueStoppedError());
    }
    const result = new Promise<DocumentResult>((resolve, reject) => {
      this.schedule(ref, rule, { resolve, reject });
    });
    this.pump();
    return result;
  }

  /** Start processing (work enqueued earlier is held until now). */
  start(): void {
    this.started = true;
    this.pump();
  }

  /** {@inheritDoc PausableQueue.pause} */
  pause(): void {
    this.paused = true;
  }

  /** {@inheritDoc PausableQueue.resume} */
  resume(): void {
    this.paused = false;
    this.pump();
  }

  /** {@inheritDoc PausableQueue.waitForIdleWorkers} */
  async waitForIdleWorkers(): Promise<void> {
    if (this.inFlight.size === 0) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /** Resolve once nothing is pending, owed (dirty) or in flight. */
  async drain(): Promise<void> {
    if (this.isIdle()) return;
    await new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  /**
   * Stop: drop pending and owed runs (their `processNow` callers reject with
   * {@link SourceNotifyQueueStoppedError}), refuse new work, and resolve once
   * in-flight runs finish.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    const error = new SourceNotifyQueueStoppedError();
    for (const job of this.pending.values()) rejectAll(job, error);
    this.pending.clear();
    for (const run of this.inFlight.values()) {
      if (run.dirty) rejectAll(run.dirty, error);
      run.dirty = undefined;
    }
    this.settle();
    await this.waitForIdleWorkers();
  }

  private schedule(ref: string, rule: string, waiter?: Waiter): void {
    const running = this.inFlight.get(ref);
    const job = running
      ? (running.dirty ??= { ref, rule, waiters: [] })
      : this.pending.get(ref);
    if (job) {
      job.rule = rule;
      if (waiter) job.waiters.push(waiter);
      return;
    }
    this.pending.set(ref, { ref, rule, waiters: waiter ? [waiter] : [] });
  }

  private pump(): void {
    if (this.started && !this.paused && !this.stopped) {
      while (this.inFlight.size < this.concurrency) {
        const next = this.pending.values().next();
        if (next.done) break;
        this.pending.delete(next.value.ref);
        this.run(next.value);
      }
    }
    this.settle();
  }

  private run(job: Job): void {
    const state: InFlight = {};
    this.inFlight.set(job.ref, state);
    void this.execute(job).then((result) => {
      this.inFlight.delete(job.ref);
      for (const waiter of job.waiters) waiter.resolve(result);
      if (state.dirty) this.pending.set(job.ref, state.dirty);
      this.pump();
    });
  }

  private async execute(job: Job): Promise<DocumentResult> {
    try {
      return await this.processor.processSource(job.ref, job.rule);
    } catch (error) {
      const err = normalizeError(error);
      this.logger?.error(
        { err, source: job.ref },
        'Source notify run failed unexpectedly',
      );
      return {
        source: job.ref,
        status: 'failed',
        error: { code: UNEXPECTED_ERROR_CODE, message: err.message },
      };
    }
  }

  private isIdle(): boolean {
    return this.inFlight.size === 0 && this.pending.size === 0;
  }

  private settle(): void {
    if (this.inFlight.size === 0) {
      const idle = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of idle) resolve();
    }
    if (this.isIdle()) {
      const drained = this.drainWaiters;
      this.drainWaiters = [];
      for (const resolve of drained) resolve();
    }
  }
}

function rejectAll(job: Job, error: Error): void {
  for (const waiter of job.waiters) waiter.reject(error);
  job.waiters = [];
}
