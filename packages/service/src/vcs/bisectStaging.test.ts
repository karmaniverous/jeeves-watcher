/**
 * @module vcs/bisectStaging.test
 * Staging bisection (D72): halves on timeouts down to single paths, other errors propagate, the budget (three times the first timeout, at most 30 minutes) caps every call and ends the batch.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  BISECTION_BUDGET_MAX_MS,
  stageWithBisection,
  type StagingAttempt,
} from './bisectStaging';
import { GitTimeoutError } from './gitProcess';

const timeout = () => new GitTimeoutError('git add', 1, 0, 1, false);
const paths = (n: number) =>
  Array.from({ length: n }, (_, i) => `p${String(i)}`);

describe('stageWithBisection', () => {
  it('stages in one attempt when nothing times out', async () => {
    const attempt = vi.fn<StagingAttempt>(() => Promise.resolve(['big']));

    expect(
      await stageWithBisection(paths(4), attempt, { timeoutFor: () => 1000 }),
    ).toEqual({ overCap: ['big'], unstaged: [] });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('splits around a path that always times out and re-queues only it', async () => {
    const attempt = vi.fn<StagingAttempt>((batch) =>
      batch.includes('p2') ? Promise.reject(timeout()) : Promise.resolve([]),
    );
    const onTimeout = vi.fn();

    const result = await stageWithBisection(paths(8), attempt, {
      timeoutFor: () => 1000,
      onTimeout,
    });

    expect(result).toEqual({ overCap: [], unstaged: ['p2'] });
    // p0-7 fails; p0-3 fails; p0-1 ok; p2-3 fails; p2 fails; p3 ok; p4-7 ok.
    expect(attempt.mock.calls.map(([batch]) => batch.length)).toEqual([
      8, 4, 2, 2, 1, 1, 4,
    ]);
    expect(onTimeout).toHaveBeenCalledTimes(4);
  });

  it('propagates errors other than timeouts', async () => {
    const boom = new Error('fatal: bad');

    await expect(
      stageWithBisection(paths(4), () => Promise.reject(boom), {
        timeoutFor: () => 1000,
      }),
    ).rejects.toBe(boom);
  });

  it('caps each call by the budget left and stops when it runs out (D72)', async () => {
    let clock = 0;
    const seen: number[] = [];
    // Every attempt times out after using its whole timeout.
    const attempt: StagingAttempt = (batch, timeoutFor) => {
      const ms = timeoutFor(batch.length);
      seen.push(ms);
      clock += ms;
      return Promise.reject(timeout());
    };

    const result = await stageWithBisection(paths(16), attempt, {
      timeoutFor: () => 100,
      now: () => clock,
    });

    expect(clock).toBeLessThanOrEqual(300);
    expect(result.unstaged.sort()).toEqual(paths(16).sort());
    expect(seen.every((ms) => ms <= 100)).toBe(true);
  });

  it('caps the budget at 30 minutes', async () => {
    let clock = 0;
    const attempt: StagingAttempt = (batch, timeoutFor) => {
      clock += timeoutFor(batch.length);
      return Promise.reject(timeout());
    };

    await stageWithBisection(paths(4), attempt, {
      timeoutFor: () => 20 * 60_000,
      now: () => clock,
    });

    expect(clock).toBe(BISECTION_BUDGET_MAX_MS);
  });

  it("spends only what is left of a caller's deadline (one budget across retries)", async () => {
    let clock = 0;
    const attempt: StagingAttempt = (batch, timeoutFor) => {
      clock += timeoutFor(batch.length);
      return Promise.reject(timeout());
    };

    const result = await stageWithBisection(paths(4), attempt, {
      timeoutFor: () => 1000,
      now: () => clock,
      deadline: 500,
    });

    expect(clock).toBe(500);
    expect(result.unstaged).toHaveLength(4);
  });
});
