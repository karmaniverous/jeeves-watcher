/**
 * @module vcs/gitArgs.test
 * Every VCS git invocation carries {@link GIT_BASE_ARGS}
 * (`-c core.longpaths=true`). See #249.
 *
 * `execFileAsync` is wrapped in a spy that delegates to the real
 * implementation, so these tests run real git against temp repos while
 * recording argv.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execFileAsync as testExec } from '../test/git';
import { createCommit, daysAgo, makeRetention } from '../test/squashRepo';
import type * as GitExecModule from './gitExec';
import { execFileAsync, GIT_BASE_ARGS } from './gitExec';
import { SquashManager } from './SquashManager';
import { initRepo } from './vcsBootstrap';
import { VcsManager } from './VcsManager';

vi.mock('./gitExec', async (importOriginal) => {
  const actual = await importOriginal<typeof GitExecModule>();
  return { ...actual, execFileAsync: vi.fn(actual.execFileAsync) };
});

const silentLogger = pino({ level: 'silent' });

const vcsConfig: VcsConfig = {
  enabled: true,
  commitThrottleMs: 60000,
  maxBatchSize: 1000,
  staleLockThresholdMs: 60000,
  maxConsecutiveFailures: 5,
  circuitBreakerCooldownMs: 300000,
  branch: 'master',
};

/** argv of every recorded `git` call. */
function gitCalls(): string[][] {
  return vi
    .mocked(execFileAsync)
    .mock.calls.filter(([file]) => file === 'git')
    .map(([, args]) => [...(args ?? [])]);
}

describe('VCS git argv (#249)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-argv-'));
    await initRepo(tempDir);
    await testExec('git', ['config', 'user.email', 'test@test.com'], {
      cwd: tempDir,
    });
    await testExec('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
    vi.mocked(execFileAsync).mockClear();
  });

  afterEach(async () => {
    vi.mocked(execFileAsync).mockClear();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('VcsManager and SquashManager pass core.longpaths on every git call', async () => {
    await createCommit(tempDir, 'old1.txt', 'a', daysAgo(60));
    await createCommit(tempDir, 'old2.txt', 'b', daysAgo(50));

    const manager = new VcsManager(tempDir, vcsConfig, silentLogger);
    await manager.start();
    await manager.reconcileDeletions(() => true);
    const file = join(tempDir, 'new.txt');
    await writeFile(file, 'new', 'utf8');
    manager.fileChanged(file);
    await rm(join(tempDir, 'old1.txt'));
    manager.handleUnlink(join(tempDir, 'old1.txt'));
    await manager.flush();
    await manager.stop();

    const squash = new SquashManager(tempDir, makeRetention(), silentLogger);
    expect((await squash.runSquash()).squashed).toBe(true);

    // The stdin add/rm helpers spawn git through execFile directly; they
    // also build argv with gitArgs() and are covered by the long-path test.
    const calls = gitCalls();
    const subcommands = calls.map((args) => args[GIT_BASE_ARGS.length]);
    expect(subcommands).toEqual(
      expect.arrayContaining([
        'ls-files',
        'diff',
        'rev-parse',
        'commit',
        'status',
        'log',
        'checkout',
        'reset',
        'commit-tree',
        'cherry-pick',
        'branch',
      ]),
    );
    for (const args of calls) {
      expect(args.slice(0, GIT_BASE_ARGS.length)).toEqual([...GIT_BASE_ARGS]);
    }
  }, 30000);

  it.runIf(process.platform === 'win32')(
    'commits a path longer than MAX_PATH on Windows',
    async () => {
      // Hermetic test env ignores system/global config, so core.longpaths is
      // only on because the watcher passes it.
      let dir = tempDir;
      while (dir.length < 240) dir = join(dir, 'a-rather-long-directory-name');
      await mkdir(dir, { recursive: true });
      const file = join(dir, 'a-long-file-name-to-exceed-max-path.txt');
      expect(file.length).toBeGreaterThan(260);
      await writeFile(file, 'long', 'utf8');

      const manager = new VcsManager(tempDir, vcsConfig, silentLogger);
      await manager.start();
      manager.fileChanged(file);
      await manager.flush();
      await manager.stop();

      expect(manager.breakerState.consecutiveFailures).toBe(0);
      const { stdout } = await testExec(
        'git',
        ['-c', 'core.longpaths=true', 'ls-files'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('a-long-file-name-to-exceed-max-path.txt');
    },
    30000,
  );
});
