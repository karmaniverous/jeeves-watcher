import { describe, expect, it } from 'vitest';

import { isPathWatched } from './isPathWatched';

describe('isPathWatched', () => {
  const watchPaths = ['j:/domains/**/*.json', 'j:/domains/**/*.md'];
  const ignoredPaths = ['**/node_modules/**', '**/.git/**'];

  it('returns true for a path matching a watch glob', () => {
    expect(isPathWatched('j:/domains/slack/msg.json', watchPaths)).toBe(true);
  });

  it('returns false for a path not matching any watch glob', () => {
    expect(isPathWatched('j:/other/file.txt', watchPaths)).toBe(false);
  });

  it('returns false for a path matching an ignored glob', () => {
    expect(
      isPathWatched(
        'j:/domains/node_modules/pkg/file.json',
        watchPaths,
        ignoredPaths,
      ),
    ).toBe(false);
  });

  it('returns true when ignored is empty', () => {
    expect(isPathWatched('j:/domains/test.md', watchPaths, [])).toBe(true);
  });

  it('returns true when ignored is undefined', () => {
    expect(isPathWatched('j:/domains/test.md', watchPaths)).toBe(true);
  });

  it('normalises backslashes', () => {
    expect(isPathWatched('j:\\domains\\slack\\msg.json', watchPaths)).toBe(
      true,
    );
  });
});
