/**
 * @module vcs/VcsManager.sizeCap.test
 * VcsManager end to end on real repos: a tracked file that grows past `vcs.maxFileBytes` is untracked in its own commit and stays on disk (D80, D147); a batch whose every git call times out releases RootGitLock within its budget and re-queues its files as one failure (D72, test-only timeout override).
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  git,
  makeFastVcsConfig as makeConfig,
  makeTempRepo,
} from '../test/vcsRepo';
import { VcsManager } from './VcsManager';

const silentLogger = pino({ level: 'silent' });
let repo: string;

beforeEach(async () => {
  repo = await makeTempRepo('vcs-sizecap-');
});

afterEach(async () => {
  await rm(repo, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
});

describe('VcsManager size cap (D80)', () => {
  it('untracks a tracked file that grows past the cap, in its own commit, keeping it on disk', async () => {
    let cap = 0;
    const manager = new VcsManager(
      repo,
      makeConfig(),
      silentLogger,
      undefined,
      undefined,
      undefined,
      {
        getMaxFileBytes: () => cap,
      },
    );
    await manager.start();
    manager.endBaseline();
    const big = join(repo, 'big.bin');
    const note = join(repo, 'note.md');
    await writeFile(big, 'small');
    manager.fileChanged(big);
    await manager.flush();

    cap = 10;
    await writeFile(big, 'x'.repeat(50));
    await writeFile(note, 'same batch');
    manager.fileChanged(big);
    manager.fileChanged(note);
    await manager.flush();
    // Later changes to the over-cap file stage nothing.
    await writeFile(big, 'y'.repeat(60));
    manager.fileChanged(big);
    await manager.flush();
    await manager.stop();

    const subjects = (await git(repo, 'log', '--format=%s')).trim().split('\n');
    expect(subjects).toHaveLength(3);
    expect(subjects[1]).toBe('watcher: untrack 1 file over vcs.maxFileBytes');
    expect(
      (await git(repo, 'show', '--name-only', '--format=', 'HEAD~1')).trim(),
    ).toBe('big.bin');
    expect((await git(repo, 'ls-files')).trim()).toBe('note.md');
    expect(await readFile(big, 'utf8')).toBe('y'.repeat(60));
  });
});

describe('VcsManager staging timeouts (D72)', () => {
  it('releases the lock within the budget and re-queues the batch as one failure', async () => {
    const manager = new VcsManager(
      repo,
      makeConfig(),
      silentLogger,
      undefined,
      undefined,
      undefined,
      {
        timeoutFor: () => 1,
      },
    );
    await manager.start();
    manager.endBaseline();
    const files = ['a.md', 'b.md', 'c.md', 'd.md'].map((n) => join(repo, n));
    for (const f of files) {
      await writeFile(f, f);
      manager.fileChanged(f);
    }

    const started = Date.now();
    await manager.flush();
    const elapsed = Date.now() - started;

    expect(manager.lock.heldBy).toBeUndefined();
    expect(elapsed).toBeLessThan(15_000);
    expect(manager.breakerState).toMatchObject({
      consecutiveFailures: 1,
      pendingCount: 4,
    });
    expect((await git(repo, 'ls-files')).trim()).toBe('');
    await manager.stop().catch(() => undefined);
  }, 60_000);
});
