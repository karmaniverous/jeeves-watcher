/**
 * @module embedding/itemRateWindow.test
 * ItemRateWindow: at most `limit` items in any 60 s, waits until enough earlier grants leave the window, the interactive reserve background requests leave free, limit rounding, and the over-capacity guard.
 */

import { describe, expect, it } from 'vitest';

import { ItemRateWindow, RATE_WINDOW_MS } from './itemRateWindow';

describe('ItemRateWindow', () => {
  it('admits items up to the limit, then waits for the oldest grants to leave', () => {
    const window = new ItemRateWindow(100);
    expect(window.waitMs(60, 0, true)).toBe(0);
    window.take(60, 0);
    expect(window.waitMs(40, 1_000, true)).toBe(0);
    window.take(40, 1_000);

    // 30 more need the first grant (60) gone: at 60 s.
    expect(window.waitMs(30, 10_000, true)).toBe(RATE_WINDOW_MS - 10_000);
    // 100 need both gone: at 61 s.
    expect(window.waitMs(100, 10_000, true)).toBe(
      RATE_WINDOW_MS + 1_000 - 10_000,
    );
    // At exactly 60 s the first grant has expired.
    expect(window.waitMs(60, RATE_WINDOW_MS, true)).toBe(0);
    expect(window.waitMs(61, RATE_WINDOW_MS, true)).toBe(1_000);
  });

  it('leaves the reserve free of background requests for interactive ones', () => {
    const window = new ItemRateWindow(100);
    expect(window.backgroundLimit).toBe(90);
    window.take(90, 0);

    // A background request waits for the window to drain...
    expect(window.waitMs(1, 1_000)).toBe(RATE_WINDOW_MS - 1_000);
    // ...while an interactive one takes the reserve at once.
    expect(window.waitMs(10, 1_000, true)).toBe(0);
    window.take(10, 1_000);
    expect(window.waitMs(1, 2_000, true)).toBe(RATE_WINDOW_MS - 2_000);
  });

  it.each([
    [100, 90, 100],
    [4000, 3940, 4000],
    [5, 4, 5],
    [1, 1, 1],
  ])(
    'with a limit of %i, background requests take %i and interactive ones %i',
    (limit, background, interactive) => {
      const window = new ItemRateWindow(limit);
      expect(window.capacity(false)).toBe(background);
      expect(window.capacity(true)).toBe(interactive);
    },
  );

  it.each([
    [4000.9, 4000],
    [0.5, 1],
  ])('rounds %d items per minute down to %i (at least 1)', (rate, limit) => {
    expect(new ItemRateWindow(rate).limit).toBe(limit);
  });

  it('refuses a request larger than its capacity', () => {
    expect(() => new ItemRateWindow(10).waitMs(11, 0, true)).toThrow(
      RangeError,
    );
    expect(() => new ItemRateWindow(10).waitMs(10, 0)).toThrow(RangeError);
  });
});
