/**
 * @module embedding/itemRateWindow
 * Sliding 60-second window counting embedded items (texts), so no 60 s span ever holds more than the limit: matches per-minute provider quotas. Background requests leave a small reserve free for interactive ones (search). Pure; reads only the times it is given.
 */

/** Length of the rate window, in ms. */
export const RATE_WINDOW_MS = 60_000;

/** Share of the limit kept free of background requests for interactive ones. */
const INTERACTIVE_RESERVE_SHARE = 0.1;

/** Most items per minute reserved for interactive requests. */
const MAX_INTERACTIVE_RESERVE = 60;

/** One grant: `count` items taken at `atMs`. */
interface Grant {
  atMs: number;
  count: number;
}

/**
 * Items taken in the last {@link RATE_WINDOW_MS}, capped at `limit`. Unlike
 * a token bucket (which lets a full bucket plus a minute's refill through
 * in the first minute), any 60 s span holds at most `limit` items.
 *
 * Capacity frees only as grants leave the window, so a window that
 * background requests keep full frees it in bursts up to 60 s apart. Those
 * requests therefore stop at {@link ItemRateWindow.backgroundLimit}: the
 * reserve above it (10% of the limit, at most 60 items, none when the limit
 * is 1) is left for interactive requests, so a search never waits behind a
 * reindex.
 */
export class ItemRateWindow {
  /** Most items any 60 s span may hold (a whole number, at least 1). */
  readonly limit: number;

  /** Most items a 60 s span may hold once a background request is taken. */
  readonly backgroundLimit: number;

  private readonly grants: Grant[] = [];
  private used = 0;

  /**
   * @param perMinute - Items per minute; rounded down, at least 1.
   */
  constructor(perMinute: number) {
    this.limit = Math.max(1, Math.floor(perMinute));
    const reserve = Math.min(
      MAX_INTERACTIVE_RESERVE,
      Math.ceil(this.limit * INTERACTIVE_RESERVE_SHARE),
      this.limit - 1,
    );
    this.backgroundLimit = this.limit - reserve;
  }

  /**
   * Most items one request may take: the limit for an interactive request,
   * {@link ItemRateWindow.backgroundLimit} otherwise.
   *
   * @param interactive - Whether the request may use the reserve.
   * @returns The capacity in items.
   */
  capacity(interactive: boolean): number {
    return interactive ? this.limit : this.backgroundLimit;
  }

  /**
   * Milliseconds until `count` more items fit in the window (0 if they fit
   * now).
   *
   * @param count - Items wanted; at most {@link ItemRateWindow.capacity}.
   * @param nowMs - Current time.
   * @param interactive - Whether the request may use the reserve.
   * @returns The wait in ms.
   */
  waitMs(count: number, nowMs: number, interactive = false): number {
    this.expire(nowMs);
    const capacity = this.capacity(interactive);
    let excess = this.used + count - capacity;
    if (excess <= 0) return 0;
    for (const grant of this.grants) {
      excess -= grant.count;
      if (excess <= 0) return grant.atMs + RATE_WINDOW_MS - nowMs;
    }
    // Only reachable when count > capacity, which callers never ask for.
    throw new RangeError(
      `Cannot take ${String(count)} items: the window holds at most ${String(capacity)}`,
    );
  }

  /**
   * Record `count` items taken at `nowMs` (call when {@link waitMs} is 0).
   *
   * @param count - Items taken.
   * @param nowMs - Current time.
   */
  take(count: number, nowMs: number): void {
    this.grants.push({ atMs: nowMs, count });
    this.used += count;
  }

  /** Drop grants older than the window. */
  private expire(nowMs: number): void {
    let expired = 0;
    for (const grant of this.grants) {
      if (grant.atMs + RATE_WINDOW_MS > nowMs) break;
      this.used -= grant.count;
      expired++;
    }
    this.grants.splice(0, expired);
  }
}
