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
});
