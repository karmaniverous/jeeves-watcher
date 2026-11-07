/**
 * @module embedding/itemRateWindow
 * Sliding 60-second window counting embedded items (texts), so no 60 s span ever holds more than the limit: matches per-minute provider quotas. Pure; reads only the times it is given.
 */

/** Length of the rate window, in ms. */
export const RATE_WINDOW_MS = 60_000;

/** One grant: `count` items taken at `atMs`. */
interface Grant {
  atMs: number;
  count: number;
}

/**
 * Items taken in the last {@link RATE_WINDOW_MS}, capped at `limit`. Unlike
 * a token bucket (which lets a full bucket plus a minute's refill through
 * in the first minute), any 60 s span holds at most `limit` items.
 */
export class ItemRateWindow {
  /** Most items any 60 s span may hold (a whole number, at least 1). */
  readonly limit: number;

  private readonly grants: Grant[] = [];
  private used = 0;

  /**
   * @param perMinute - Items per minute; rounded down, at least 1.
   */
  constructor(perMinute: number) {
    this.limit = Math.max(1, Math.floor(perMinute));
  }

  /**
   * Milliseconds until `count` more items fit in the window (0 if they fit
   * now).
   *
   * @param count - Items wanted; at most {@link ItemRateWindow.limit}.
   * @param nowMs - Current time.
   * @returns The wait in ms.
   */
  waitMs(count: number, nowMs: number): number {
    this.expire(nowMs);
    let excess = this.used + count - this.limit;
    if (excess <= 0) return 0;
    for (const grant of this.grants) {
      excess -= grant.count;
      if (excess <= 0) return grant.atMs + RATE_WINDOW_MS - nowMs;
    }
    // Only reachable when count > limit, which callers never ask for.
    throw new RangeError(
      `Cannot take ${String(count)} items: the window holds at most ${String(this.limit)}`,
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
