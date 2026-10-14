/**
 * @module sources/semaphore.test
 * Tests for the counting semaphore: cap enforced, FIFO hand-off, release on rejection, invalid limits.
 */

import { describe, expect, it } from 'vitest';

import { Semaphore } from './semaphore';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Semaphore', () => {
  it('never runs more than the limit at once and hands off in FIFO order', async () => {
    const sem = new Semaphore(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    let active = 0;
    let peak = 0;

    const runs = gates.map((gate, i) =>
      sem.run(async () => {
        started.push(i);
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
        return i;
      }),
    );

    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    gates[1].resolve();
    await runs[1];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates[0].resolve();
    gates[2].resolve();
    gates[3].resolve();

    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(started).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });

  it('releases the slot when the task rejects', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await sem.run(() => Promise.resolve('next'))).toBe('next');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects limit %d', (limit) => {
    expect(() => new Semaphore(limit)).toThrow(RangeError);
  });
});
