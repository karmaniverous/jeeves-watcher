/**
 * @module watcher/globToDir.test
 * Tests for glob-to-directory resolution used by the filesystem watcher on Windows.
 */

import { describe, expect, it } from 'vitest';

import {
  buildGlobMatcher,
  deduplicateRoots,
  expandBareDirectoryGlob,
  globRoot,
  resolveIgnored,
  resolveWatchPaths,
} from './globToDir';

describe('globRoot', () => {
  it('extracts root from simple glob', () => {
    expect(globRoot('c:/data/**/*.json')).toBe('c:/data');
  });

  it('extracts root from brace expansion glob', () => {
    expect(globRoot('c:/config/**/*.{json,md,txt}')).toBe('c:/config');
  });

  it('handles drive letter only', () => {
    expect(globRoot('d:/**/*.md')).toBe('d:');
  });

  it('handles no glob characters', () => {
    expect(globRoot('c:/data/tickets/issues')).toBe('c:/data/tickets/issues');
  });

  it('handles glob in first segment', () => {
    expect(globRoot('**/*.md')).toBe('.');
  });

  it('normalizes backslashes', () => {
    expect(globRoot('c:\\data\\**\\*.json')).toBe('c:/data');
  });
});

describe('deduplicateRoots', () => {
  it('removes subdirectories', () => {
    const result = deduplicateRoots([
      'c:/data',
      'c:/data/tickets',
      'c:/config',
    ]);
    expect(result).toEqual(['c:/config', 'c:/data']);
  });

  it('handles identical entries', () => {
    const result = deduplicateRoots(['c:/data', 'c:/data']);
    expect(result).toEqual(['c:/data']);
  });

  it('keeps unrelated roots', () => {
    const result = deduplicateRoots(['c:/config', 'c:/data', 'c:/srv']);
    expect(result).toEqual(['c:/config', 'c:/data', 'c:/srv']);
  });
});

describe('buildGlobMatcher', () => {
  it('matches files against glob patterns', () => {
    const matches = buildGlobMatcher([
      'c:/data/**/*.json',
      'c:/config/**/*.md',
    ]);

    expect(matches('c:/data/tickets/issues/PROJ-1.json')).toBe(true);
    expect(matches('c:/config/readme.md')).toBe(true);
    expect(matches('c:/data/tickets/issues/PROJ-1.txt')).toBe(false);
    expect(matches('c:/other/file.json')).toBe(false);
  });

  it('handles brace expansion', () => {
    const matches = buildGlobMatcher(['c:/data/**/*.{json,md,txt}']);

    expect(matches('c:/data/file.json')).toBe(true);
    expect(matches('c:/data/file.md')).toBe(true);
    expect(matches('c:/data/file.txt')).toBe(true);
    expect(matches('c:/data/file.ts')).toBe(false);
  });

  it('normalizes backslashes in input paths', () => {
    const matches = buildGlobMatcher(['c:/data/**/*.json']);
    expect(matches('c:\\data\\tickets\\PROJ-1.json')).toBe(true);
  });

  it('is case-insensitive', () => {
    const matches = buildGlobMatcher(['c:/data/**/*.json']);
    expect(matches('C:/Data/Tickets/PROJ-1.JSON')).toBe(true);
  });
});

describe('expandBareDirectoryGlob', () => {
  it('appends /** to a bare directory path', () => {
    expect(expandBareDirectoryGlob('c:/data')).toBe('c:/data/**');
  });

  it('appends /** to a deep bare directory path', () => {
    expect(expandBareDirectoryGlob('/opt/jeeves/content')).toBe(
      '/opt/jeeves/content/**',
    );
  });

  it('strips trailing slash before appending /**', () => {
    expect(expandBareDirectoryGlob('c:/data/')).toBe('c:/data/**');
  });

  it('does not modify a path that already has glob characters', () => {
    expect(expandBareDirectoryGlob('c:/data/**/*.json')).toBe(
      'c:/data/**/*.json',
    );
  });

  it('does not modify a path with a question-mark glob', () => {
    expect(expandBareDirectoryGlob('c:/data/file?.json')).toBe(
      'c:/data/file?.json',
    );
  });

  it('does not modify a path with a brace glob', () => {
    expect(expandBareDirectoryGlob('c:/data/**/*.{json,md}')).toBe(
      'c:/data/**/*.{json,md}',
    );
  });

  it('does not modify a path with a bracket glob', () => {
    expect(expandBareDirectoryGlob('c:/data/[abc].json')).toBe(
      'c:/data/[abc].json',
    );
  });
});

describe('resolveWatchPaths', () => {
  it('returns deduplicated roots and a working matcher', () => {
    const { roots, matches } = resolveWatchPaths([
      'c:/data/**/*.{json,md}',
      'c:/data/tickets/**/*.json',
      'c:/config/**/*.json',
    ]);

    expect(roots).toEqual(['c:/config', 'c:/data']);
    expect(matches('c:/data/tickets/PROJ-1.json')).toBe(true);
    expect(matches('c:/config/watcher.json')).toBe(true);
    expect(matches('c:/data/file.py')).toBe(false);
  });

  it('bare directory path matches files recursively under it', () => {
    const { matches } = resolveWatchPaths(['/opt/jeeves/content']);

    expect(matches('/opt/jeeves/content/legacy/chat/file.json')).toBe(true);
    expect(matches('/opt/jeeves/content/readme.md')).toBe(true);
    expect(matches('/opt/jeeves/other/file.json')).toBe(false);
  });

  it('bare directory path produces the correct chokidar root', () => {
    const { roots } = resolveWatchPaths(['/opt/jeeves/content']);
    expect(roots).toEqual(['/opt/jeeves/content']);
  });

  it('mix of bare paths and glob patterns works correctly', () => {
    const { roots, matches } = resolveWatchPaths([
      'c:/data',
      'c:/config/**/*.json',
    ]);

    expect(roots).toEqual(['c:/config', 'c:/data']);
    expect(matches('c:/data/legacy/chat/file.md')).toBe(true);
    expect(matches('c:/config/watcher.json')).toBe(true);
    expect(matches('c:/config/readme.md')).toBe(false);
    expect(matches('/opt/other/file.json')).toBe(false);
  });

  it('paths with glob characters are not modified (regression guard)', () => {
    const { matches } = resolveWatchPaths(['c:/data/**/*.json']);

    // Files matching the original glob still match
    expect(matches('c:/data/tickets/PROJ-1.json')).toBe(true);
    // Files that would only match if /** were appended (non-json) should not
    expect(matches('c:/data/tickets/PROJ-1.md')).toBe(false);
  });
});

describe('resolveIgnored', () => {
  it('converts glob strings to matcher functions', () => {
    const resolved = resolveIgnored(['**/node_modules/**']);
    expect(resolved).toHaveLength(1);
    expect(typeof resolved[0]).toBe('function');

    const matcher = resolved[0] as (path: string) => boolean;
    expect(matcher('c:/data/projects/foo/node_modules/bar/baz.js')).toBe(true);
    expect(matcher('c:/data/projects/foo/src/index.ts')).toBe(false);
  });

  it('matches node_modules at any depth', () => {
    const [matcher] = resolveIgnored(['**/node_modules/**']) as ((
      path: string,
    ) => boolean)[];
    expect(matcher('c:/app/temp/node_modules/@types/node/net.d.ts')).toBe(true);
    expect(
      matcher(
        'c:/data/projects/example-book/book/node_modules/puppeteer-core/lib/foo.js',
      ),
    ).toBe(true);
    expect(matcher('c:/data/projects/example-book/src/index.ts')).toBe(false);
  });

  it('normalizes backslashes before matching', () => {
    const [matcher] = resolveIgnored(['**/node_modules/**']) as ((
      path: string,
    ) => boolean)[];
    expect(matcher('c:\\data\\projects\\foo\\node_modules\\bar\\baz.js')).toBe(
      true,
    );
  });

  it('is case-insensitive', () => {
    const [matcher] = resolveIgnored(['**/Node_Modules/**']) as ((
      path: string,
    ) => boolean)[];
    expect(matcher('C:/Data/foo/node_modules/bar.js')).toBe(true);
  });

  it('passes through function entries unchanged', () => {
    const fn = (path: string) => path.includes('skip');
    const resolved = resolveIgnored([fn]);
    expect(resolved[0]).toBe(fn);
  });

  it('passes through RegExp entries unchanged', () => {
    const re = /\.tmp$/;
    const resolved = resolveIgnored([re]);
    expect(resolved[0]).toBe(re);
  });

  it('handles mixed glob patterns', () => {
    const resolved = resolveIgnored([
      '**/node_modules/**',
      '**/.git/**',
      '**/package-lock.json',
    ]);
    expect(resolved).toHaveLength(3);
    resolved.forEach((m) => {
      expect(typeof m).toBe('function');
    });

    const matchers = resolved as ((path: string) => boolean)[];
    expect(matchers[0]('c:/foo/node_modules/bar.js')).toBe(true);
    expect(matchers[1]('c:/foo/.git/config')).toBe(true);
    expect(matchers[2]('c:/foo/bar/package-lock.json')).toBe(true);
    expect(matchers[2]('c:/foo/bar/package.json')).toBe(false);
  });
});
