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
    expect(globRoot('j:/domains/**/*.json')).toBe('j:/domains');
  });

  it('extracts root from brace expansion glob', () => {
    expect(globRoot('j:/config/**/*.{json,md,txt}')).toBe('j:/config');
  });

  it('handles drive letter only', () => {
    expect(globRoot('d:/**/*.md')).toBe('d:');
  });

  it('handles no glob characters', () => {
    expect(globRoot('j:/domains/jira/issues')).toBe('j:/domains/jira/issues');
  });

  it('handles glob in first segment', () => {
    expect(globRoot('**/*.md')).toBe('.');
  });

  it('normalizes backslashes', () => {
    expect(globRoot('j:\\domains\\**\\*.json')).toBe('j:/domains');
  });
});

describe('deduplicateRoots', () => {
  it('removes subdirectories', () => {
    const result = deduplicateRoots([
      'j:/domains',
      'j:/domains/jira',
      'j:/config',
    ]);
    expect(result).toEqual(['j:/config', 'j:/domains']);
  });

  it('handles identical entries', () => {
    const result = deduplicateRoots(['j:/domains', 'j:/domains']);
    expect(result).toEqual(['j:/domains']);
  });

  it('keeps unrelated roots', () => {
    const result = deduplicateRoots(['j:/config', 'j:/domains', 'j:/jeeves']);
    expect(result).toEqual(['j:/config', 'j:/domains', 'j:/jeeves']);
  });
});

describe('buildGlobMatcher', () => {
  it('matches files against glob patterns', () => {
    const matches = buildGlobMatcher([
      'j:/domains/**/*.json',
      'j:/config/**/*.md',
    ]);

    expect(matches('j:/domains/jira/issues/WEB-1.json')).toBe(true);
    expect(matches('j:/config/readme.md')).toBe(true);
    expect(matches('j:/domains/jira/issues/WEB-1.txt')).toBe(false);
    expect(matches('j:/other/file.json')).toBe(false);
  });

  it('handles brace expansion', () => {
    const matches = buildGlobMatcher(['j:/domains/**/*.{json,md,txt}']);

    expect(matches('j:/domains/file.json')).toBe(true);
    expect(matches('j:/domains/file.md')).toBe(true);
    expect(matches('j:/domains/file.txt')).toBe(true);
    expect(matches('j:/domains/file.ts')).toBe(false);
  });

  it('normalizes backslashes in input paths', () => {
    const matches = buildGlobMatcher(['j:/domains/**/*.json']);
    expect(matches('j:\\domains\\jira\\WEB-1.json')).toBe(true);
  });

  it('is case-insensitive', () => {
    const matches = buildGlobMatcher(['j:/domains/**/*.json']);
    expect(matches('J:/Domains/Jira/WEB-1.JSON')).toBe(true);
  });
});

describe('expandBareDirectoryGlob', () => {
  it('appends /** to a bare directory path', () => {
    expect(expandBareDirectoryGlob('j:/domains')).toBe('j:/domains/**');
  });

  it('appends /** to a deep bare directory path', () => {
    expect(expandBareDirectoryGlob('/opt/jeeves/content')).toBe(
      '/opt/jeeves/content/**',
    );
  });

  it('strips trailing slash before appending /**', () => {
    expect(expandBareDirectoryGlob('j:/domains/')).toBe('j:/domains/**');
  });

  it('does not modify a path that already has glob characters', () => {
    expect(expandBareDirectoryGlob('j:/domains/**/*.json')).toBe(
      'j:/domains/**/*.json',
    );
  });

  it('does not modify a path with a question-mark glob', () => {
    expect(expandBareDirectoryGlob('j:/domains/file?.json')).toBe(
      'j:/domains/file?.json',
    );
  });

  it('does not modify a path with a brace glob', () => {
    expect(expandBareDirectoryGlob('j:/domains/**/*.{json,md}')).toBe(
      'j:/domains/**/*.{json,md}',
    );
  });

  it('does not modify a path with a bracket glob', () => {
    expect(expandBareDirectoryGlob('j:/domains/[abc].json')).toBe(
      'j:/domains/[abc].json',
    );
  });
});

describe('resolveWatchPaths', () => {
  it('returns deduplicated roots and a working matcher', () => {
    const { roots, matches } = resolveWatchPaths([
      'j:/domains/**/*.{json,md}',
      'j:/domains/jira/**/*.json',
      'j:/config/**/*.json',
    ]);

    expect(roots).toEqual(['j:/config', 'j:/domains']);
    expect(matches('j:/domains/jira/WEB-1.json')).toBe(true);
    expect(matches('j:/config/watcher.json')).toBe(true);
    expect(matches('j:/domains/file.py')).toBe(false);
  });

  it('bare directory path matches files recursively under it', () => {
    const { matches } = resolveWatchPaths(['/opt/jeeves/content']);

    expect(matches('/opt/jeeves/content/legacy/slack/file.json')).toBe(true);
    expect(matches('/opt/jeeves/content/readme.md')).toBe(true);
    expect(matches('/opt/jeeves/other/file.json')).toBe(false);
  });

  it('bare directory path produces the correct chokidar root', () => {
    const { roots } = resolveWatchPaths(['/opt/jeeves/content']);
    expect(roots).toEqual(['/opt/jeeves/content']);
  });

  it('mix of bare paths and glob patterns works correctly', () => {
    const { roots, matches } = resolveWatchPaths([
      'j:/domains',
      'j:/config/**/*.json',
    ]);

    expect(roots).toEqual(['j:/config', 'j:/domains']);
    expect(matches('j:/domains/legacy/slack/file.md')).toBe(true);
    expect(matches('j:/config/watcher.json')).toBe(true);
    expect(matches('j:/config/readme.md')).toBe(false);
    expect(matches('/opt/other/file.json')).toBe(false);
  });

  it('paths with glob characters are not modified (regression guard)', () => {
    const { matches } = resolveWatchPaths(['j:/domains/**/*.json']);

    // Files matching the original glob still match
    expect(matches('j:/domains/jira/WEB-1.json')).toBe(true);
    // Files that would only match if /** were appended (non-json) should not
    expect(matches('j:/domains/jira/WEB-1.md')).toBe(false);
  });
});

describe('resolveIgnored', () => {
  it('converts glob strings to matcher functions', () => {
    const resolved = resolveIgnored(['**/node_modules/**']);
    expect(resolved).toHaveLength(1);
    expect(typeof resolved[0]).toBe('function');

    const matcher = resolved[0] as (path: string) => boolean;
    expect(matcher('j:/domains/projects/foo/node_modules/bar/baz.js')).toBe(
      true,
    );
    expect(matcher('j:/domains/projects/foo/src/index.ts')).toBe(false);
  });

  it('matches node_modules at any depth', () => {
    const [matcher] = resolveIgnored(['**/node_modules/**']) as ((
      path: string,
    ) => boolean)[];
    expect(matcher('j:/jeeves/temp/node_modules/@types/node/net.d.ts')).toBe(
      true,
    );
    expect(
      matcher(
        'j:/domains/projects/tiny-poems/book/node_modules/puppeteer-core/lib/foo.js',
      ),
    ).toBe(true);
    expect(matcher('j:/domains/projects/tiny-poems/src/index.ts')).toBe(false);
  });

  it('normalizes backslashes before matching', () => {
    const [matcher] = resolveIgnored(['**/node_modules/**']) as ((
      path: string,
    ) => boolean)[];
    expect(
      matcher('j:\\domains\\projects\\foo\\node_modules\\bar\\baz.js'),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    const [matcher] = resolveIgnored(['**/Node_Modules/**']) as ((
      path: string,
    ) => boolean)[];
    expect(matcher('J:/Domains/foo/node_modules/bar.js')).toBe(true);
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
    expect(matchers[0]('j:/foo/node_modules/bar.js')).toBe(true);
    expect(matchers[1]('j:/foo/.git/config')).toBe(true);
    expect(matchers[2]('j:/foo/bar/package-lock.json')).toBe(true);
    expect(matchers[2]('j:/foo/bar/package.json')).toBe(false);
  });
});
