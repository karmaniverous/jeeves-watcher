/**
 * @module vcs/BatchCommitter.test
 * One staging budget per batch (D72): an `index.lock` retry reuses the deadline the first attempt started, so bisection can't restart it on every retry. Real temp repo; `commit` spied.
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeTempRepo } from '../test/vcsRepo';
import { BatchCommitter, type CommitContext } from './BatchCommitter';
import type { CommitMessageBuilder } from './CommitMessageBuilder';
import { OverCapWarnings } from './OverCapWarnings';

let repo: string;

beforeEach(async () => {
  repo = await makeTempRepo('batch-committer-');
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(repo, { recursive: true, force: true });
});

const makeCommitter = () =>
  new BatchCommitter({
    rootPath: repo,
    logger: pino({ level: 'silent' }),
    messageBuilder: {} as CommitMessageBuilder,
    staleLockThresholdMs: 60_000,
    getMaxFileBytes: () => 0,
    warnings: new OverCapWarnings(),
    timeoutFor: () => 1000,
  });

describe('BatchCommitter.commit', () => {
  it('stages nothing once the batch deadline has passed', async () => {
    const file = join(repo, 'a.md');
    await writeFile(file, 'a');

    const outcome = await makeCommitter().commit([file], {
      attempt: 2,
      isBaseline: false,
      pendingReversions: [],
      deadline: Date.now() - 1,
    });

    expect(outcome).toEqual({ committed: false, unstaged: [file] });
  });
});

describe('BatchCommitter.commitWithRetry', () => {
  it('passes every index.lock retry the deadline of the first attempt', async () => {
    const committer = makeCommitter();
    const contexts: CommitContext[] = [];
    vi.spyOn(committer, 'commit').mockImplementation((_files, context) => {
      contexts.push(context);
      return context.attempt === 1
        ? Promise.reject(new Error("Unable to create '.git/index.lock'"))
        : Promise.resolve({ committed: true, unstaged: [] });
    });

    const before = Date.now();
    await committer.commitWithRetry(['a.md'], {
      isBaseline: false,
      pendingReversions: [],
    });

    expect(contexts.map((c) => c.attempt)).toEqual([1, 2]);
    expect(contexts[1].deadline).toBe(contexts[0].deadline);
    expect(contexts[0].deadline).toBeGreaterThanOrEqual(before + 3000);
    expect(contexts[0].deadline).toBeLessThanOrEqual(Date.now() + 3000);
  });
});
