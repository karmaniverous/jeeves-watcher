/**
 * @module watcher/batch/BatchFifo
 * The serial work queue parcel batches go through (D149): one task at a time, in arrival order, so a root's batches are classified and applied in order. A root's tasks wait while it is paused (its initial walk). Pairing timers run here too. Pure.
 */

import type pino from 'pino';

import { normalizeError } from '../../util/normalizeError';

/** A unit of queued work. */
export type BatchTask = () => Promise<void> | void;

/** A serial queue with per-root pauses. */
export class BatchFifo {
  private chain: Promise<void> = Promise.resolve();
  private readonly paused = new Map<string, BatchTask[]>();
  private stopped = false;

  /** @param logger - Logs a task that throws (the queue goes on). */
  constructor(private readonly logger: pino.Logger) {}

  /**
   * Queue work for a root (held while the root is paused).
   *
   * @param root - The root, or undefined for work of no root.
   * @param task - The work.
   */
  push(root: string | undefined, task: BatchTask): void {
    const held = root === undefined ? undefined : this.paused.get(root);
    if (held) held.push(task);
    else this.run(task);
  }

  /** Hold a root's work (its initial walk is running). */
  pause(root: string): void {
    if (!this.paused.has(root)) this.paused.set(root, []);
  }

  /** Release a root's held work, in order, after anything queued before. */
  resume(root: string): void {
    const held = this.paused.get(root);
    this.paused.delete(root);
    for (const task of held ?? []) this.run(task);
  }

  /** Resolves once every queued task has run. */
  idle(): Promise<void> {
    return this.chain;
  }

  /** Drop held work and refuse more. */
  stop(): void {
    this.stopped = true;
    this.paused.clear();
  }

  private run(task: BatchTask): void {
    this.chain = this.chain.then(async () => {
      if (this.stopped) return;
      try {
        await task();
      } catch (error) {
        this.logger.error(
          { err: normalizeError(error) },
          'Change batch handling failed',
        );
      }
    });
  }
}
