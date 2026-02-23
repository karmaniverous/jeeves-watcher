/**
 * @module watcher/globToDir.test
 * Tests for glob-to-directory resolution used by the filesystem watcher on Windows.
 */

import { describe, expect, it } from 'vitest';

import {
  buildGlobMatcher,
  deduplicateRoots,
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
    expect(
      matcher('j:/jeeves/temp/node_modules/@types/node/net.d.ts'),
    ).toBe(true);
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
    const resolved = resolveIgnored([fn as unknown as string]);
    expect(resolved[0]).toBe(fn);
  });

  it('passes through RegExp entries unchanged', () => {
    const re = /\.tmp$/;
    const resolved = resolveIgnored([re as unknown as string]);
    expect(resolved[0]).toBe(re);
  });

  it('handles mixed glob patterns', () => {
    const resolved = resolveIgnored([
      '**/node_modules/**',
      '**/.git/**',
      '**/package-lock.json',
    ]);
    expect(resolved).toHaveLength(3);
    resolved.forEach((m) => expect(typeof m).toBe('function'));

    const matchers = resolved as ((path: string) => boolean)[];
    expect(matchers[0]('j:/foo/node_modules/bar.js')).toBe(true);
    expect(matchers[1]('j:/foo/.git/config')).toBe(true);
    expect(matchers[2]('j:/foo/bar/package-lock.json')).toBe(true);
    expect(matchers[2]('j:/foo/bar/package.json')).toBe(false);
  });
});
