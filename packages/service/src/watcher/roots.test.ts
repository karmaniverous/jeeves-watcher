/**
 * @module watcher/roots.test
 * Root lookup and each root's `.git` (D152).
 */

import { describe, expect, it } from 'vitest';

import { WatchRoots } from './roots';

describe('WatchRoots', () => {
  const roots = new WatchRoots(['c:/data', 'c:/other']);

  it('finds the root a path lies under, case-insensitively', () => {
    expect(roots.rootOf('C:\\Data\\x\\y.md')).toBe('c:/data');
    expect(roots.rootOf('c:/other')).toBe('c:/other');
    expect(roots.rootOf('c:/database/z')).toBeUndefined();
  });

  it.each([
    ['c:/data/.git', true],
    ['C:\\Data\\.git\\objects\\ab', true],
    ['c:/other/.git/index', true],
    ['c:/data/.gitignore', false],
    ['c:/data/.github/x', false],
    ['c:/data/sub/.git/index', false],
    ['c:/elsewhere/.git/index', false],
  ])('isRootGit(%s) is %s', (path, expected) => {
    expect(roots.isRootGit(path)).toBe(expected);
  });
});
