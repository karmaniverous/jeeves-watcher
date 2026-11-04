/**
 * @module vcs/CommitQueue.test
 * A batch that throws (instead of resolving false) is logged and kept, and the chain carries on, so the root keeps committing. No git.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { CommitQueue } from './CommitQueue';
import { RootGitLock } from './RootGitLock';

describe('CommitQueue', () => {
  it('keeps a batch that throws, logs it, and commits later batches', async () => {
    const logger = pino({ level: 'silent' });
    const error = vi.spyOn(logger, 'error');
    const commit = vi
      .fn<(batch: string[]) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(true);
    const queue = new CommitQueue({
      maxBatchSize: 10,
      throttleMs: 60_000,
      onThrottle: () => undefined,
      lock: new RootGitLock('/r', logger),
      commit,
      root: '/r',
      logger,
    });

    queue.add('/r/a.md');
    await queue.flush();
    expect(error).toHaveBeenCalledTimes(1);
    expect(queue.backlog).toBe(1);

    await queue.flush();
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith(['/r/a.md']);
    expect(queue.backlog).toBe(0);
  });

  it('counts a thrown batch as a failure and retries it at the next throttle', async () => {
    vi.useFakeTimers();
    try {
      const logger = pino({ level: 'silent' });
      const onThrow = vi.fn();
      const onThrottle = vi.fn();
      const queue = new CommitQueue({
        maxBatchSize: 10,
        throttleMs: 1000,
        onThrottle,
        lock: new RootGitLock('/r', logger),
        commit: () => Promise.reject(new Error('boom')),
        root: '/r',
        logger,
        onThrow,
      });

      queue.add('/r/a.md');
      await queue.flush();

      expect(onThrow).toHaveBeenCalledWith('boom', 1);
      expect(onThrottle).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onThrottle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
