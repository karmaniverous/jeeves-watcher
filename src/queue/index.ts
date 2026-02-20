/**
 * A watch event.
 */
export type WatchEvent = {
  /** Event type. */
  type: 'create' | 'modify' | 'delete';
  /** File path associated with the event. */
  path: string;
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
  /** Optional max processed events per minute (token bucket). */
  rateLimitPerMinute?: number;
}

/**
 * A debounced, rate-limited, concurrent event queue.
 */
export class EventQueue {
  private readonly debounceMs: number;
  private readonly concurrency: number;
  private readonly rateLimitPerMinute?: number;

  private started = false;
  private active = 0;

  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly latestByKey = new Map<string, QueuedItem>();

  private readonly normalQueue: QueuedItem[] = [];
  private readonly lowQueue: QueuedItem[] = [];

  private tokens: number;
  private lastRefillMs = Date.now();

  private drainWaiters: Array<() => void> = [];

  /**
   * Create an event queue.
   *
   * @param options - Queue options.
   */
  public constructor(options: EventQueueOptions) {
    this.debounceMs = options.debounceMs;
    this.concurrency = options.concurrency;
    this.rateLimitPerMinute = options.rateLimitPerMinute;
    this.tokens = this.rateLimitPerMinute ?? Number.POSITIVE_INFINITY;
  }

  /**
   * Enqueue an event, debounced per path+priority.
   *
   * @param event - The watch event.
   * @param fn - The processing function to invoke when dequeued.
   */
  public enqueue(event: WatchEvent, fn: ProcessFn): void {
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
   * Start processing events.
   */
  public process(): void {
    this.started = true;
    this.pump();
  }

  /**
   * Wait for the queue to become idle (no pending debounces, no queued items, no active work).
   *
   * @returns A promise that resolves when the queue is drained.
   */
  public async drain(): Promise<void> {
    if (this.isIdle()) return;
    await new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  private push(item: QueuedItem): void {
    if (item.event.priority === 'low') this.lowQueue.push(item);
    else this.normalQueue.push(item);
  }

  private refillTokens(nowMs: number): void {
    if (this.rateLimitPerMinute === undefined) return;

    const elapsed = Math.max(0, nowMs - this.lastRefillMs);
    const refillRatePerMs = this.rateLimitPerMinute / 60000;
    const refill = elapsed * refillRatePerMs;

    this.tokens = Math.min(this.rateLimitPerMinute, this.tokens + refill);
    this.lastRefillMs = nowMs;
  }

  private takeToken(): boolean {
    const now = Date.now();
    this.refillTokens(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private nextItem(): QueuedItem | undefined {
    return this.normalQueue.shift() ?? this.lowQueue.shift();
  }

  private pump(): void {
    if (!this.started) return;

    while (this.active < this.concurrency) {
      const item = this.nextItem();
      if (!item) break;

      if (!this.takeToken()) {
        // Put it back at the front of its queue and try later.
        if (item.event.priority === 'low') this.lowQueue.unshift(item);
        else this.normalQueue.unshift(item);
        setTimeout(() => {
          this.pump();
        }, 250);
        break;
      }

      this.active += 1;
      void Promise.resolve()
        .then(() => item.fn(item.event))
        .finally(() => {
          this.active -= 1;
          this.pump();
          this.maybeResolveDrain();
        });
    }

    this.maybeResolveDrain();
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

  private maybeResolveDrain(): void {
    if (!this.isIdle()) return;
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
