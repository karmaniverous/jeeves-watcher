/**
 * @module vcs/gitExec.test
 * Unit tests for findRootForPath and isIndexLockError.
 */

import { describe, expect, it } from 'vitest';

import { findRootForPath, isIndexLockError } from './gitExec';

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
