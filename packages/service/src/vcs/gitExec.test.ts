/**
 * @module vcs/gitExec.test
 * Unit tests for findRootForPath, isIndexLockError, and gitAddViaStdin.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findRootForPath, gitAddViaStdin, isIndexLockError } from './gitExec';
import { initRepo } from './vcsBootstrap';

const execFileAsync = promisify(execFile);

describe('findRootForPath', () => {
  it('returns matching root for path under a single root', () => {
    expect(findRootForPath(['/a'], '/a/foo/bar')).toBe('/a');
  });

  it('returns longest matching root when roots are nested', () => {
    // Roots sorted longest-first as required by the function contract
    const roots = ['/a/b', '/a'];
    expect(findRootForPath(roots, '/a/b/c')).toBe('/a/b');
  });

  it('returns undefined for path outside all roots', () => {
    expect(findRootForPath(['/a', '/b'], '/c/d')).toBeUndefined();
  });

  it('returns root itself when path equals root exactly', () => {
    expect(findRootForPath(['/a/b', '/a'], '/a/b')).toBe('/a/b');
  });

  it('handles empty roots array', () => {
    expect(findRootForPath([], '/a/b/c')).toBeUndefined();
  });

  it('matches case-insensitively on Windows (drive letter mismatch)', () => {
    const roots = ['j:/domains/projects'];
    expect(
      findRootForPath(roots, 'J:/domains/projects/file.txt', 'win32'),
    ).toBe('j:/domains/projects');
  });

  it('matches case-insensitively on Windows (root uppercase, path lowercase)', () => {
    const roots = ['J:/Domains/Projects'];
    expect(
      findRootForPath(roots, 'j:/domains/projects/file.txt', 'win32'),
    ).toBe('J:/Domains/Projects');
  });

  it('matches case-insensitively on Windows (exact path equals root)', () => {
    const roots = ['j:/domains'];
    expect(findRootForPath(roots, 'J:/domains', 'win32')).toBe('j:/domains');
  });
});

describe('gitAddViaStdin', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'git-add-stdin-'));
    await initRepo(tempDir);
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], {
      cwd: tempDir,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: tempDir,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stages a single file', async () => {
    const filePath = join(tempDir, 'hello.txt');
    await writeFile(filePath, 'hello', 'utf8');

    await gitAddViaStdin([filePath], tempDir);

    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only'],
      { cwd: tempDir },
    );
    expect(stdout.trim()).toBe('hello.txt');
  });

  it('stages multiple files in one call', async () => {
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = join(tempDir, `file${String(i)}.txt`);
      await writeFile(p, `content ${String(i)}`, 'utf8');
      paths.push(p);
    }

    await gitAddViaStdin(paths, tempDir);

    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only'],
      { cwd: tempDir },
    );
    const staged = stdout.trim().split('\n').sort();
    expect(staged).toEqual([
      'file0.txt',
      'file1.txt',
      'file2.txt',
      'file3.txt',
      'file4.txt',
    ]);
  });

  it('stages deleted files correctly', async () => {
    const filePath = join(tempDir, 'to-delete.txt');
    await writeFile(filePath, 'content', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '-m', 'add file'], {
      cwd: tempDir,
    });

    await rm(filePath);
    await gitAddViaStdin([filePath], tempDir);

    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-status'],
      { cwd: tempDir },
    );
    expect(stdout.trim()).toMatch(/^D\s+to-delete\.txt$/);
  });

  it('handles files with spaces in paths', async () => {
    const filePath = join(tempDir, 'file with spaces.txt');
    await writeFile(filePath, 'content', 'utf8');

    await gitAddViaStdin([filePath], tempDir);

    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only'],
      { cwd: tempDir },
    );
    expect(stdout.trim()).toBe('file with spaces.txt');
  });
});

describe('isIndexLockError', () => {
  it('returns true for Error with index.lock in message', () => {
    expect(isIndexLockError(new Error('unable to create index.lock'))).toBe(
      true,
    );
  });

  it('returns true for Error with index.lock in stderr property', () => {
    const err = new Error('git failed');
    (err as unknown as Record<string, unknown>).stderr =
      'fatal: Unable to create index.lock';
    expect(isIndexLockError(err)).toBe(true);
  });

  it('returns true for Error with EEXIST in message', () => {
    expect(isIndexLockError(new Error('EEXIST: file already exists'))).toBe(
      true,
    );
  });

  it('returns false for Error with unrelated message', () => {
    expect(isIndexLockError(new Error('permission denied'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isIndexLockError('index.lock')).toBe(false);
    expect(isIndexLockError(null)).toBe(false);
    expect(isIndexLockError(undefined)).toBe(false);
  });
});
