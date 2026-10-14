import { describe, expect, it } from 'vitest';

import { isPathWatched } from './isPathWatched';

describe('isPathWatched', () => {
  const watchPaths = ['c:/data/**/*.json', 'c:/data/**/*.md'];
  const ignoredPaths = ['**/node_modules/**', '**/.git/**'];

  it('returns true for a path matching a watch glob', () => {
    expect(isPathWatched('c:/data/chat/msg.json', watchPaths)).toBe(true);
  });

  it('returns false for a path not matching any watch glob', () => {
    expect(isPathWatched('c:/other/file.txt', watchPaths)).toBe(false);
  });

  it('returns false for a path matching an ignored glob', () => {
    expect(
      isPathWatched(
        'c:/data/node_modules/pkg/file.json',
        watchPaths,
        ignoredPaths,
      ),
    ).toBe(false);
  });

  it('returns true when ignored is empty', () => {
    expect(isPathWatched('c:/data/test.md', watchPaths, [])).toBe(true);
  });

  it('returns true when ignored is undefined', () => {
    expect(isPathWatched('c:/data/test.md', watchPaths)).toBe(true);
  });

  it('normalises backslashes', () => {
    expect(isPathWatched('c:\\data\\chat\\msg.json', watchPaths)).toBe(true);
  });

  it.skipIf(process.platform !== 'win32')(
    'matches mixed-case drive letters on Windows',
    () => {
      expect(isPathWatched('C:/data/foo.md', watchPaths)).toBe(true);
      expect(isPathWatched('C:/data/foo.json', watchPaths)).toBe(true);
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'case-insensitive ignored paths on Windows',
    () => {
      const ignored = ['C:/data/SECRET/**'];
      expect(isPathWatched('c:/data/secret/file.md', watchPaths, ignored)).toBe(
        false,
      );
    },
  );
});
