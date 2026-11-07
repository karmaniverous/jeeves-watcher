/**
 * @module embedding/itemRateWindow.test
 * ItemRateWindow: at most `limit` items in any 60 s, waits until enough earlier grants leave the window, limit rounding, and the over-limit guard.
 */

import { describe, expect, it } from 'vitest';

import { ItemRateWindow, RATE_WINDOW_MS } from './itemRateWindow';

describe('ItemRateWindow', () => {
  it('admits items up to the limit, then waits for the oldest grants to leave', () => {
    const window = new ItemRateWindow(100);
    expect(window.waitMs(60, 0)).toBe(0);
    window.take(60, 0);
    expect(window.waitMs(40, 1_000)).toBe(0);
    window.take(40, 1_000);

    // 30 more need the first grant (60) gone: at 60 s.
    expect(window.waitMs(30, 10_000)).toBe(RATE_WINDOW_MS - 10_000);
    // 100 need both gone: at 61 s.
    expect(window.waitMs(100, 10_000)).toBe(RATE_WINDOW_MS + 1_000 - 10_000);
    // At exactly 60 s the first grant has expired.
    expect(window.waitMs(60, RATE_WINDOW_MS)).toBe(0);
    expect(window.waitMs(61, RATE_WINDOW_MS)).toBe(1_000);
  });

  it.each([
    [4000.9, 4000],
    [0.5, 1],
  ])('rounds %d items per minute down to %i (at least 1)', (rate, limit) => {
    expect(new ItemRateWindow(rate).limit).toBe(limit);
  });

  it('refuses a request larger than the limit', () => {
    expect(() => new ItemRateWindow(10).waitMs(11, 0)).toThrow(RangeError);
  });
});
