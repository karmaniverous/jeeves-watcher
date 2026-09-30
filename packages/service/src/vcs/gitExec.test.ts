/**
 * @module vcs/gitExec.test
 * Unit tests for the pure gitExec helpers: argv pinning, error field
 * extraction and classification, and path comparison.
 */

import { describe, expect, it } from 'vitest';

import {
  findRootForPath,
  getErrorCode,
  getExecErrorFields,
  GIT_BASE_ARGS,
  gitArgs,
  isIndexLockError,
  pathKey,
} from './gitExec';

function execError(message: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error(message), fields);
}

describe('gitArgs', () => {
  it('prefixes core.longpaths=true ahead of the subcommand', () => {
    expect(GIT_BASE_ARGS).toEqual(['-c', 'core.longpaths=true']);
    expect(gitArgs('commit', '-m', 'x')).toEqual([
      '-c',
      'core.longpaths=true',
      'commit',
      '-m',
      'x',
    ]);
  });

  it('returns a fresh array each call', () => {
    const first = gitArgs('status');
    first.push('mutated');
    expect(gitArgs('status')).toEqual(['-c', 'core.longpaths=true', 'status']);
  });
});

describe('findRootForPath', () => {
  it('returns matching root for path under a single root', () => {
    expect(findRootForPath(['/a'], '/a/foo/bar')).toBe('/a');
  });

  it('returns longest matching root when roots are nested', () => {
    // Roots sorted longest-first as required by the function contract
    expect(findRootForPath(['/a/b', '/a'], '/a/b/c')).toBe('/a/b');
  });

  it('returns undefined for path outside all roots', () => {
    expect(findRootForPath(['/a', '/b'], '/c/d')).toBeUndefined();
  });

  it('does not match a sibling that shares a prefix', () => {
    expect(findRootForPath(['/a/b'], '/a/bc/file')).toBeUndefined();
  });

  it('returns root itself when path equals root exactly', () => {
    expect(findRootForPath(['/a/b', '/a'], '/a/b')).toBe('/a/b');
  });

  it('handles empty roots array', () => {
    expect(findRootForPath([], '/a/b/c')).toBeUndefined();
  });

  it('matches case-insensitively on Windows in both directions', () => {
    expect(
      findRootForPath(
        ['j:/domains/projects'],
        'J:/domains/projects/file.txt',
        'win32',
      ),
    ).toBe('j:/domains/projects');
    expect(
      findRootForPath(
        ['J:/Domains/Projects'],
        'j:/domains/projects/file.txt',
        'win32',
      ),
    ).toBe('J:/Domains/Projects');
    expect(findRootForPath(['j:/domains'], 'J:/domains', 'win32')).toBe(
      'j:/domains',
    );
  });

  it('is case-sensitive on other platforms', () => {
    expect(
      findRootForPath(['/Data'], '/data/file.txt', 'linux'),
    ).toBeUndefined();
  });
});

describe('pathKey', () => {
  it('lowercases for the win32 platform', () => {
    // resolve() follows the host OS, so use a path that is absolute on both.
    expect(pathKey('/Repo/Sub/File.TXT', 'win32')).toMatch(
      /\/repo\/sub\/file\.txt$/,
    );
  });

  it.runIf(process.platform === 'win32')(
    'converts Windows backslashes to forward slashes',
    () => {
      expect(pathKey('C:\\Repo\\Sub\\File.TXT', 'win32')).toBe(
        'c:/repo/sub/file.txt',
      );
    },
  );

  it('preserves case on other platforms', () => {
    expect(pathKey('/Repo/File.TXT', 'linux')).toMatch(/Repo\/File\.TXT$/);
  });

  it('resolves relative segments so equivalent paths compare equal', () => {
    expect(pathKey('/repo/a/../b.txt', 'linux')).toBe(
      pathKey('/repo/b.txt', 'linux'),
    );
  });
});

describe('getExecErrorFields', () => {
  it('extracts message, stderr, and stdout from an ExecFileException', () => {
    const fields = getExecErrorFields(
      execError('Command failed: git commit', {
        stderr: 'fatal: nothing to commit',
        stdout: 'On branch master\nnothing to commit',
      }),
    );
    expect(fields).toEqual({
      message: 'Command failed: git commit',
      stderr: 'fatal: nothing to commit',
      stdout: 'On branch master\nnothing to commit',
    });
  });

  it('returns empty stderr/stdout when absent or not strings', () => {
    expect(getExecErrorFields(new Error('plain error'))).toEqual({
      message: 'plain error',
      stderr: '',
      stdout: '',
    });
    expect(
      getExecErrorFields(
        execError('typed error', { stderr: 123, stdout: { obj: true } }),
      ),
    ).toEqual({ message: 'typed error', stderr: '', stdout: '' });
  });

  it('stringifies non-Error values', () => {
    expect(getExecErrorFields('string error').message).toBe('string error');
    expect(getExecErrorFields(42).message).toBe('42');
    expect(getExecErrorFields(null).message).toBe('null');
  });
});

describe('getErrorCode', () => {
  it('returns numeric exit codes and string errno codes', () => {
    expect(getErrorCode(execError('exit', { code: 1 }))).toBe(1);
    expect(getErrorCode(execError('fs', { code: 'ENOENT' }))).toBe('ENOENT');
  });

  it('returns undefined for values without a usable code', () => {
    expect(getErrorCode(new Error('no code'))).toBeUndefined();
    expect(getErrorCode(execError('odd', { code: { x: 1 } }))).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
    expect(getErrorCode('ENOENT')).toBeUndefined();
    expect(getErrorCode(1)).toBeUndefined();
  });

  it('reads code from plain objects, not only Errors', () => {
    expect(getErrorCode({ code: 128 })).toBe(128);
  });
});

describe('isIndexLockError', () => {
  it('returns true when the message names index.lock', () => {
    expect(isIndexLockError(new Error('unable to create index.lock'))).toBe(
      true,
    );
  });

  it('returns true when only stderr names index.lock', () => {
    expect(
      isIndexLockError(
        execError('git failed', {
          stderr: "fatal: Unable to create '/r/.git/index.lock': File exists.",
        }),
      ),
    ).toBe(true);
  });

  it('returns false for a bare EEXIST that does not involve index.lock', () => {
    // Regression (#251 review): EEXIST on any other file is deterministic
    // and must not be retried as lock contention.
    expect(isIndexLockError(new Error('EEXIST: file already exists'))).toBe(
      false,
    );
    expect(
      isIndexLockError(
        execError('mkdir failed', { stderr: "EEXIST: '/r/notes'" }),
      ),
    ).toBe(false);
  });

  it('returns false for unrelated errors and non-Error values', () => {
    expect(isIndexLockError(new Error('permission denied'))).toBe(false);
    expect(isIndexLockError('index.lock')).toBe(false);
    expect(isIndexLockError(null)).toBe(false);
    expect(isIndexLockError(undefined)).toBe(false);
  });
});
