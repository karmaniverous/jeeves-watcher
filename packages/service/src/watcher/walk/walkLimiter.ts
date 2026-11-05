/**
 * @module watcher/walk/walkLimiter
 * The process-wide walk limiter (D170): at most 8 walk filesystem calls in flight across every walk, initial or reconcile, so walks never fill the libuv threadpool. Pure.
 */

/** Runs one filesystem call under a concurrency limit. */
export type WalkLimit = <T>(call: () => Promise<T>) => Promise<T>;

/** Walk filesystem calls in flight at once, process-wide (D170). */
export const WALK_CONCURRENCY = 8;

/**
 * A FIFO concurrency limiter.
 *
 * @param max - Calls in flight at once.
 * @returns A function running each call when a slot is free.
 */
export function createLimiter(max: number): WalkLimit {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(call: () => Promise<T>): Promise<T> => {
    // A finishing call hands its slot straight to the next waiter, so a
    // newcomer can never slip in between and exceed `max`.
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      return await call();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** The limiter every walk shares (D170). */
export const walkLimit: WalkLimit = createLimiter(WALK_CONCURRENCY);
