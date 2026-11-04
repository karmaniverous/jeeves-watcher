/**
 * @module vcs/gitKill.windows.test
 * Windows only (D79): a 20,000-file `git add` killed by its timeout leaves no running git.exe and no `index.lock`. Runs on the Windows CI runner.
 */

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeTempRepo } from '../test/vcsRepo';
import { gitAdd } from './gitIndex';
import { type GitTimeoutError, isGitTimeout } from './gitProcess';

/** Whether a process id is still running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.runIf(process.platform === 'win32')('git kill on Windows', () => {
  let repo: string;
  const paths: string[] = [];

  beforeAll(async () => {
    repo = await makeTempRepo('git-kill-');
    for (let d = 0; d < 20; d++) {
      await mkdir(join(repo, `d${String(d)}`));
      const writes: Promise<void>[] = [];
      for (let f = 0; f < 1000; f++) {
        const rel = `d${String(d)}/f${String(f)}.md`;
        paths.push(rel);
        writes.push(writeFile(join(repo, rel), `file ${rel}\n`));
      }
      await Promise.all(writes);
    }
  }, 300_000);

  afterAll(async () => {
    await rm(repo, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  });

  it('kills a timed-out 20,000-file add: no git.exe left, no index.lock', async () => {
    const error: unknown = await gitAdd(repo, paths, { timeoutMs: 300 }).catch(
      (e: unknown) => e,
    );

    expect(isGitTimeout(error)).toBe(true);
    const { pid } = error as GitTimeoutError;
    expect(pid).toBeTypeOf('number');
    expect(isRunning(pid ?? -1)).toBe(false);
    await expect(stat(join(repo, '.git', 'index.lock'))).rejects.toThrow();
  }, 120_000);
});
