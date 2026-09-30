/**
 * @module vcs/gitArgs.test
 * Every VCS git invocation carries {@link GIT_BASE_ARGS}
 * (`-c core.longpaths=true`), and a failed squash aborts its cherry-pick
 * before forcing a checkout. See #249.
 *
 * `execFileAsync` is wrapped in a spy that delegates to the real
 * implementation, so these tests run real git against temp repos while
 * recording argv.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execFileAsync as testExec } from '../test/git';
import type * as GitExecModule from './gitExec';
import { execFileAsync, GIT_BASE_ARGS, gitArgs } from './gitExec';
import { SquashManager } from './SquashManager';
import { initRepo } from './vcsBootstrap';
import { VcsManager } from './VcsManager';

vi.mock('./gitExec', async (importOriginal) => {
  const actual = await importOriginal<typeof GitExecModule>();
  return { ...actual, execFileAsync: vi.fn(actual.execFileAsync) };
});

const silentLogger = pino({ level: 'silent' });

/** argv of every recorded `git` call. */
function gitCalls(): string[][] {
  return vi
    .mocked(execFileAsync)
    .mock.calls.filter(([file]) => file === 'git')
    .map(([, args]) => [...(args ?? [])]);
}

async function commitAt(
  cwd: string,
  name: string,
  daysAgo: number,
): Promise<void> {
  await writeFile(join(cwd, name), name, 'utf8');
  await testExec('git', ['add', name], { cwd });
  const date = new Date(Date.now() - daysAgo * 86400000).toISOString();
  await testExec('git', ['commit', '-m', `add ${name}`], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

describe('gitArgs', () => {
  it('prefixes core.longpaths=true', () => {
    expect(GIT_BASE_ARGS).toEqual(['-c', 'core.longpaths=true']);
    expect(gitArgs('commit', '-m', 'x')).toEqual([
      '-c',
      'core.longpaths=true',
      'commit',
      '-m',
      'x',
    ]);
  });
});

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
    await commitAt(tempDir, 'old1.txt', 60);
    await commitAt(tempDir, 'old2.txt', 50);

    const manager = new VcsManager(
      tempDir,
      {
        enabled: true,
        commitThrottleMs: 60000,
        maxBatchSize: 1000,
        staleLockThresholdMs: 60000,
        maxConsecutiveFailures: 5,
        circuitBreakerCooldownMs: 300000,
        branch: 'master',
      },
      silentLogger,
    );
    await manager.start();
    await manager.reconcileDeletions(() => true);
    const file = join(tempDir, 'new.txt');
    await writeFile(file, 'new', 'utf8');
    manager.fileChanged(file);
    await rm(join(tempDir, 'old1.txt'));
    manager.handleUnlink(join(tempDir, 'old1.txt'));
    await manager.flush();
    await manager.stop();

    const squash = new SquashManager(
      tempDir,
      { maxAgeDays: 30, maxVersions: 100, squashCron: '0 0 * * *' },
      silentLogger,
    );
    const result = await squash.runSquash();
    expect(result.squashed).toBe(true);

    // Calls made inside gitExec itself (ls-files, diff --cached, the stdin
    // add/rm helpers) bypass the module export and are not recorded here;
    // they build argv with gitArgs() too.
    const calls = gitCalls();
    const subcommands = calls.map((args) => args[GIT_BASE_ARGS.length]);
    expect(subcommands).toEqual(
      expect.arrayContaining([
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

  it('aborts a failed cherry-pick before checkout -f during squash cleanup', async () => {
    await commitAt(tempDir, 'old1.txt', 60);
    await commitAt(tempDir, 'old2.txt', 50);
    await commitAt(tempDir, 'new.txt', 1);

    const actual = await vi.importActual<typeof GitExecModule>('./gitExec');
    vi.mocked(execFileAsync).mockImplementation(((
      file: string,
      args: readonly string[],
      options: object,
    ) => {
      const sub = args[GIT_BASE_ARGS.length];
      const next = args[GIT_BASE_ARGS.length + 1];
      if (sub === 'cherry-pick' && next !== '--abort') {
        return Promise.reject(new Error('simulated cherry-pick failure'));
      }
      return actual.execFileAsync(file, args, options);
    }) as unknown as typeof execFileAsync);

    try {
      const squash = new SquashManager(
        tempDir,
        { maxAgeDays: 30, maxVersions: 100, squashCron: '0 0 * * *' },
        silentLogger,
      );
      const result = await squash.runSquash();
      expect(result.squashed).toBe(false);
      expect(result.error).toContain('simulated cherry-pick failure');
    } finally {
      vi.mocked(execFileAsync).mockImplementation(actual.execFileAsync);
    }

    const ops = gitCalls().map((args) =>
      args.slice(GIT_BASE_ARGS.length, GIT_BASE_ARGS.length + 2).join(' '),
    );
    const abortIdx = ops.indexOf('cherry-pick --abort');
    const forceIdx = ops.indexOf('checkout -f');
    expect(abortIdx).toBeGreaterThan(-1);
    expect(forceIdx).toBeGreaterThan(abortIdx);

    // Back on the configured branch with history intact
    const { stdout } = await testExec(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: tempDir },
    );
    expect(stdout.trim()).toBe('master');
    const { stdout: count } = await testExec(
      'git',
      ['rev-list', '--count', 'HEAD'],
      { cwd: tempDir },
    );
    expect(count.trim()).toBe('3');
  }, 30000);

  it.runIf(process.platform === 'win32')(
    'commits a path longer than MAX_PATH on Windows',
    async () => {
      // Hermetic test env ignores system/global config, so core.longpaths is
      // only on because the watcher passes it.
      let dir = tempDir;
      while (dir.length < 240) dir = join(dir, 'a-rather-long-directory-name');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      const file = join(dir, 'a-long-file-name-to-exceed-max-path.txt');
      expect(file.length).toBeGreaterThan(260);
      await writeFile(file, 'long', 'utf8');

      const manager = new VcsManager(
        tempDir,
        {
          enabled: true,
          commitThrottleMs: 60000,
          maxBatchSize: 1000,
          staleLockThresholdMs: 60000,
          maxConsecutiveFailures: 5,
          circuitBreakerCooldownMs: 300000,
          branch: 'master',
        },
        silentLogger,
      );
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
