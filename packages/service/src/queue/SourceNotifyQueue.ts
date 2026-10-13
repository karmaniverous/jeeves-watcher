/**
 * @module queue/SourceNotifyQueue
 * In-memory notify queue for source documents, keyed by reference: pending notifications merge, in-flight ones mark the reference dirty for exactly one re-run. Calls processSource; records an issue when it rejects unexpectedly.
 */

import type { DocumentResult } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { SourceProcessorInterface } from '../processor/types';
import { normalizeError } from '../util/normalizeError';
import type { PausableQueue } from './pausable';
import {
  type InFlight,
  type Job,
  type ProcessNowOptions,
  rejectAll,
  type SourceNotifyQueueOptions,
  sourceNotifyQueueOptionsSchema,
  SourceNotifyQueueStoppedError,
  type SourceQueueIssues,
  type Waiter,
} from './sourceNotifyTypes';

export {
  DEFAULT_SOURCE_NOTIFY_CONCURRENCY,
  type ProcessNowOptions,
  type SourceNotifyQueueOptions,
  sourceNotifyQueueOptionsSchema,
  SourceNotifyQueueStoppedError,
  type SourceQueueIssues,
} from './sourceNotifyTypes';

/** Issue code reported when `processSource` rejects unexpectedly. */
const UNEXPECTED_ERROR_CODE = 'extraction_error';

/** Operation recorded on the issue of an unexpected rejection. */
const UNEXPECTED_OPERATION = 'Source notify run failed unexpectedly';

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
 * result and an `extraction_error` issue (with the designated rule).
 *
 * Reindex runs go through {@link processNow} as well, so a notification and
 * a reindex of one reference never run in parallel and the latest state wins.
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
   * @param issues - Issues store for unexpected processing rejections.
   */
  constructor(
    private readonly processor: SourceProcessorInterface,
    options: SourceNotifyQueueOptions = {},
    private readonly logger?: pino.Logger,
    private readonly issues?: SourceQueueIssues,
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
    this.schedule(ref, rule, false);
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
   * @param options - `force` re-embeds unchanged content.
   * @returns The per-document result.
   * @throws {@link SourceNotifyQueueStoppedError} (as a rejection) when the
   *   queue is stopped before the run starts.
   */
  processNow(
    ref: string,
    rule: string,
    options: ProcessNowOptions = {},
  ): Promise<DocumentResult> {
    if (this.stopped) {
      return Promise.reject(new SourceNotifyQueueStoppedError());
    }
    const force = options.force ?? false;
    const result = new Promise<DocumentResult>((resolve, reject) => {
      this.schedule(ref, rule, force, { resolve, reject });
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

  private schedule(
    ref: string,
    rule: string,
    force: boolean,
    waiter?: Waiter,
  ): void {
    const waiters = waiter ? [waiter] : [];
    const running = this.inFlight.get(ref);
    const job = running
      ? (running.dirty ??= { ref, rule, force, waiters: [] })
      : this.pending.get(ref);
    if (!job) {
      this.pending.set(ref, { ref, rule, force, waiters });
      return;
    }
    job.rule = rule;
    job.force ||= force;
    job.waiters.push(...waiters);
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
    const { ref, rule, force } = job;
    try {
      return await this.processor.processSource(ref, rule, { force });
    } catch (error) {
      const err = normalizeError(error);
      this.logger?.error({ err, source: ref }, UNEXPECTED_OPERATION);
      this.issues?.clear(ref);
      this.issues?.record(ref, UNEXPECTED_ERROR_CODE, err.message, {
        operation: UNEXPECTED_OPERATION,
        rule,
      });
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
