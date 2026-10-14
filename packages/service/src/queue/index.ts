/**
 * @module queue
 * Debounced, concurrent event queue for file watchers. Manages priority queuing and async callbacks. Embedding request rate is limited by the shared embedding provider wrapper, not here. No direct I/O.
 */

import { IdleSignals } from './idleSignals';

export { combinePausableQueues, type PausableQueue } from './pausable';

/**
 * A watch event.
 */
export type WatchEvent = {
  /** Event type. */
  type: 'create' | 'modify' | 'delete' | 'move';
  /** File path associated with the event (new path for moves). */
  path: string;
  /** Original path before move (populated only for move events). */
  oldPath?: string;
  /** Event priority. */
  priority: 'normal' | 'low';
};

/**
 * Function invoked when a queued event is processed.
 */
export type ProcessFn = (event: WatchEvent) => Promise<void> | void;

type QueuedItem = {
  event: WatchEvent;
  fn: ProcessFn;
};

/**
 * Options for {@link EventQueue}.
 */
export interface EventQueueOptions {
  /** Debounce delay in milliseconds (applied per path+priority key). */
  debounceMs: number;
  /** Maximum number of concurrent processors. */
  concurrency: number;
}

/**
 * A debounced, concurrent event queue.
 */
export class EventQueue {
  private readonly debounceMs: number;
  private readonly concurrency: number;

  private started = false;
  private paused = false;
  private stopped = false;
  private active = 0;

  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly latestByKey = new Map<string, QueuedItem>();

  private readonly normalQueue: QueuedItem[] = [];
  private readonly lowQueue: QueuedItem[] = [];

  private readonly signals = new IdleSignals();

  /**
   * Create an event queue.
   *
   * @param options - Queue options.
   */
  public constructor(options: EventQueueOptions) {
    this.debounceMs = options.debounceMs;
    this.concurrency = options.concurrency;
  }

  /**
   * Enqueue an event, debounced per path+priority. Ignored once stopped.
   *
   * @param event - The watch event.
   * @param fn - The processing function to invoke when dequeued.
   */
  public enqueue(event: WatchEvent, fn: ProcessFn): void {
    if (this.stopped) return;
    const key = `${event.priority}:${event.path}`;
    this.latestByKey.set(key, { event, fn });

    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      const item = this.latestByKey.get(key);
      if (!item) return;
      this.latestByKey.delete(key);
      this.push(item);
      this.pump();
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }

  /**
   * Start processing events (events enqueued earlier are held until now).
   */
  public start(): void {
    this.started = true;
    this.pump();
  }

  /**
   * Alias of {@link EventQueue.start}, kept for existing callers.
   */
  public process(): void {
    this.start();
  }

  /**
   * Stop: cancel pending debounces, drop queued events, ignore new ones, and
   * resolve once in-flight work finishes. Drain waiters resolve then too.
   */
  public async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.latestByKey.clear();
    this.normalQueue.length = 0;
    this.lowQueue.length = 0;
    this.settle();
    await this.waitForIdleWorkers();
  }

  /**
   * Pause processing events. Events can still be enqueued but will not be processed.
   */
  public pause(): void {
    this.paused = true;
  }

  /**
   * Resume processing events.
   */
  public resume(): void {
    this.paused = false;
    this.pump();
  }

  /**
   * Wait for the queue to become idle (no pending debounces, no queued items, no active work).
   *
   * @returns A promise that resolves when the queue is drained.
   */
  public drain(): Promise<void> {
    return this.signals.drain(this.isIdle());
  }

  /**
   * Wait until there is no in-flight work.
   *
   * Unlike {@link drain}, this does NOT wait for debounced or queued items to be empty.
   * It's useful when you need to temporarily quiesce outgoing work without losing
   * or rejecting new enqueues.
   */
  public waitForIdleWorkers(): Promise<void> {
    return this.signals.waitForIdleWorkers(this.active === 0);
  }

  private push(item: QueuedItem): void {
    if (item.event.priority === 'low') this.lowQueue.push(item);
    else this.normalQueue.push(item);
  }

  private nextItem(): QueuedItem | undefined {
    return this.normalQueue.shift() ?? this.lowQueue.shift();
  }

  private pump(): void {
    if (!this.started || this.paused || this.stopped) return;

    while (this.active < this.concurrency) {
      const item = this.nextItem();
      if (!item) break;

      this.active += 1;
      void Promise.resolve()
        .then(() => item.fn(item.event))
        .finally(() => {
          this.active -= 1;
          this.pump();
          this.settle();
        });
    }

    this.settle();
  }

  private isIdle(): boolean {
    return (
      this.active === 0 &&
      this.normalQueue.length === 0 &&
      this.lowQueue.length === 0 &&
      this.debounceTimers.size === 0 &&
      this.latestByKey.size === 0
    );
  }

  private settle(): void {
    this.signals.settle({
      idleWorkers: this.active === 0,
      drained: this.isIdle(),
    });
  }
}
