/**
 * @module vcs/gitProcess.test
 * The git process layer (D79): real-binary resolution, stdin and buffer output, execFile-shaped exit errors, and the timeout rule (kill, await exit, remove our own `index.lock`, keep a foreign one).
 */

import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeTempRepo } from '../test/vcsRepo';
import * as gitBinaryModule from './gitBinary';
import { findGitBinary, gitBinary, killsLauncher } from './gitBinary';
import type { GitTimeoutError } from './gitProcess';
import {
  describeCommand,
  execGit,
  isGitTimeout,
  realIndexLock,
  removeOwnIndexLock,
} from './gitProcess';

let repo: string;

beforeEach(async () => {
  repo = await makeTempRepo('git-process-');
});

afterEach(async () => {
  vi.restoreAllMocks();
  // A killed git's grandchild (the alias below) may still hold the folder.
  await rm(repo, {
    recursive: true,
    force: true,
    maxRetries: 80,
    retryDelay: 200,
  });
});

/**
 * argv for a git call that hangs: an alias running node, which optionally
 * creates `.git/index.lock` first (as a git that took the lock would).
 */
function hangingGit(createLock: boolean): string[] {
  const script = `${createLock ? "require('fs').writeFileSync('.git/index.lock','');" : ''}setTimeout(()=>{},10000)`;
  return ['-c', `alias.hang=!node -e "${script}"`, 'hang'];
}

describe('gitBinary', () => {
  it('resolves the real git binary from the exec path, not a launcher', async () => {
    const binary = gitBinary();

    expect(basename(binary)).toBe(
      process.platform === 'win32' ? 'git.exe' : 'git',
    );
    expect((await stat(binary)).isFile()).toBe(true);
    expect(binary.replace(/\\/g, '/')).not.toMatch(/\/cmd\/git\.exe$/i);
  });

  it('falls back to git when the exec path is empty, missing the binary, or unreadable', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'git-exec-path-'));
    try {
      expect(findGitBinary('linux', () => '')).toBe('git');
      expect(findGitBinary('linux', () => empty)).toBe('git');
      expect(
        findGitBinary('linux', () => {
          throw new Error('no git');
        }),
      ).toBe('git');
      await writeFile(join(empty, 'git.exe'), '');
      expect(findGitBinary('win32', () => `${empty}\n`)).toBe(
        join(empty, 'git.exe'),
      );
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('execGit', () => {
  it('passes stdin and returns stdout as text and bytes', async () => {
    const result = await execGit(['hash-object', '--stdin'], {
      cwd: repo,
      timeoutMs: 30_000,
      input: Buffer.from('hello\n'),
    });

    expect(result.stdout.trim()).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a',
    );
    expect(result.stdoutBuffer.toString('utf8')).toBe(result.stdout);
  });

  it('rejects a non-zero exit with the exit code and stderr', async () => {
    await expect(
      execGit(['rev-parse', '--verify', 'no-such-ref'], {
        cwd: repo,
        timeoutMs: 30_000,
      }),
    ).rejects.toMatchObject({
      code: 128,
      stderr: expect.stringContaining('fatal') as unknown,
    });
  });

  it('rejects when stdout exceeds maxBuffer', async () => {
    await expect(
      execGit(['--version'], { cwd: repo, timeoutMs: 30_000, maxBuffer: 4 }),
    ).rejects.toThrow(/stdout exceeded 4 bytes/);
  });

  it('rejects with the spawn error when git cannot start', async () => {
    vi.spyOn(gitBinaryModule, 'gitBinary').mockReturnValue(
      join(repo, 'no-such-git'),
    );

    await expect(
      execGit(['--version'], { cwd: repo, timeoutMs: 30_000 }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('kills a timed-out call, awaits its exit and removes the index.lock it created', async () => {
    // 4 s gives the child time to start and take the lock on a busy host.
    const error: unknown = await execGit(hangingGit(true), {
      cwd: repo,
      timeoutMs: 4000,
      indexLockPath: realIndexLock(repo),
    }).catch((e: unknown) => e);

    expect(isGitTimeout(error)).toBe(true);
    const timeout = error as GitTimeoutError;
    expect(timeout.exitedAt).toBeGreaterThanOrEqual(timeout.spawnedAt);
    // Killed, not left to finish its 10 s on its own.
    expect(timeout.exitedAt - timeout.spawnedAt).toBeLessThan(9000);
    expect(timeout.removedIndexLock).toBe(true);
    await expect(stat(join(repo, '.git', 'index.lock'))).rejects.toThrow();
  }, 30_000);

  it('keeps an index.lock that predates the timed-out call', async () => {
    const lock = join(repo, '.git', 'index.lock');
    await writeFile(lock, '');
    const anHourAgo = new Date(Date.now() - 3_600_000);
    await utimes(lock, anHourAgo, anHourAgo);

    const error: unknown = await execGit(hangingGit(false), {
      cwd: repo,
      timeoutMs: 300,
      indexLockPath: lock,
    }).catch((e: unknown) => e);

    expect((error as GitTimeoutError).removedIndexLock).toBe(false);
    expect((await stat(lock)).isFile()).toBe(true);
  });

  it('leaves a lock created during a call that takes no index lock (another writer holds it)', async () => {
    // A concurrent writer takes the lock while a read (no indexLockPath)
    // hangs and times out.
    const lock = realIndexLock(repo);
    const pending = execGit(hangingGit(false), {
      cwd: repo,
      timeoutMs: 2000,
    }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 300));
    await writeFile(lock, '');
    const error = await pending;

    expect(error).toMatchObject({ name: 'GitTimeoutError' });
    expect((error as GitTimeoutError).removedIndexLock).toBe(false);
    expect((await stat(realIndexLock(repo))).isFile()).toBe(true);
  }, 30_000);
});

describe('killsLauncher', () => {
  it('is true only for plain git on Windows', () => {
    expect(killsLauncher('win32', 'git')).toBe(true);
    expect(
      killsLauncher('win32', 'C:/Git/mingw64/libexec/git-core/git.exe'),
    ).toBe(false);
    expect(killsLauncher('linux', 'git')).toBe(false);
  });
});

describe('describeCommand', () => {
  it('counts the paths after -- instead of listing them', () => {
    expect(describeCommand(['ls-files', '-z', '--', 'a.md', 'b.md'])).toBe(
      'git ls-files -z -- <2 paths>',
    );
    expect(describeCommand(['ls-files', '--', 'a.md'])).toBe(
      'git ls-files -- <1 path>',
    );
    expect(describeCommand(['log', '-1'])).toBe('git log -1');
  });

  it('keeps path lists out of a failed call message', async () => {
    const error: unknown = await execGit(
      [
        '--literal-pathspecs',
        'ls-files',
        '--error-unmatch',
        '--',
        'nope-1.md',
        'nope-2.md',
      ],
      { cwd: repo, timeoutMs: 30_000 },
    ).catch((e: unknown) => e);

    const message = (error as Error).message.split('\n')[0];
    expect(message).toContain('-- <2 paths>');
    expect(message).not.toContain('nope-1.md');
  });
});

describe('removeOwnIndexLock', () => {
  it('removes a lock only when its mtime lies in the window', async () => {
    const lock = join(repo, '.git', 'index.lock');
    await writeFile(lock, '');
    const mtime = Math.floor((await stat(lock)).mtimeMs);

    expect(await removeOwnIndexLock(lock, mtime + 1, mtime + 10)).toBe(false);
    expect(await removeOwnIndexLock(lock, mtime - 10, mtime - 1)).toBe(false);
    expect(await removeOwnIndexLock(lock, mtime, mtime)).toBe(true);
    expect(await removeOwnIndexLock(lock, 0, Date.now())).toBe(false);
  });
});
