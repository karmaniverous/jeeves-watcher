/**
 * @module util/retry.test
 * Retry policy: attempt counting, backoff delays, the shouldRetry
 * predicate, and final-error propagation.
 */

import { describe, expect, it, vi } from 'vitest';

import { retry } from './retry';

const fast = { baseDelayMs: 1, maxDelayMs: 4 };

function failTimes(n: number, error: unknown = new Error('boom')) {
  let calls = 0;
  return vi.fn((attempt: number) => {
    calls++;
    return calls <= n
      ? Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        )
      : Promise.resolve(`ok on ${String(attempt)}`);
  });
}

describe('retry', () => {
  it('returns the first success, passing the 1-based attempt number', async () => {
    const fn = failTimes(2);
    await expect(retry(fn, { attempts: 5, ...fast })).resolves.toBe('ok on 3');
    expect(fn.mock.calls.map(([a]) => a)).toEqual([1, 2, 3]);
  });

  it('throws the last error after exhausting attempts, without a final onRetry', async () => {
    const onRetry = vi.fn();
    const fn = failTimes(10, new Error('always'));

    await expect(retry(fn, { attempts: 3, ...fast, onRetry })).rejects.toThrow(
      'always',
    );

    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('reports exponential delays capped at maxDelayMs', async () => {
    const delays: number[] = [];
    await expect(
      retry(failTimes(10), {
        attempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 4,
        onRetry: ({ delayMs }) => delays.push(delayMs),
      }),
    ).rejects.toThrow();
    expect(delays).toEqual([1, 2, 4, 4]);
  });

  it('fails fast when shouldRetry rejects the error', async () => {
    const onRetry = vi.fn();
    const fatal = new Error('deterministic');
    const shouldRetry = vi.fn(() => false);
    const fn = vi.fn(() => Promise.reject(fatal));

    await expect(
      retry(fn, { attempts: 4, ...fast, shouldRetry, onRetry }),
    ).rejects.toBe(fatal);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(fatal);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries transient errors until a deterministic one, then stops', async () => {
    const transient = new Error('index.lock');
    const fatal = new Error('fatal');
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(fatal)
      .mockResolvedValue('unreachable');

    await expect(
      retry(fn, {
        attempts: 5,
        ...fast,
        shouldRetry: (e) => e === transient,
      }),
    ).rejects.toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('adds up to `jitter` proportional random delay', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const delays: number[] = [];
    try {
      await expect(
        retry(failTimes(10), {
          attempts: 3,
          baseDelayMs: 10,
          maxDelayMs: 100,
          jitter: 0.2,
          onRetry: ({ delayMs }) => delays.push(delayMs),
        }),
      ).rejects.toThrow();
    } finally {
      random.mockRestore();
    }
    // 10 * (1 + 0.5 * 0.2) = 11; 20 * 1.1 = 22
    expect(delays).toEqual([11, 22]);
  });

  it('always makes at least one attempt', async () => {
    const fn = failTimes(0);
    await expect(retry(fn, { attempts: 0, ...fast })).resolves.toBe('ok on 1');
  });
});
