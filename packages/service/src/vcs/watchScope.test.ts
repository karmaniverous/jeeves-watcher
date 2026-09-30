/**
 * @module vcs/watchScope.test
 * Watch-scope predicate: glob matching plus `watch.ignored` applied to the
 * path and every ancestor directory.
 */

import { describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { createWatchScope } from './watchScope';

function scope(
  paths: string[],
  ignored: JeevesWatcherConfig['watch']['ignored'] = [],
) {
  return createWatchScope({ paths, ignored });
}

describe('createWatchScope', () => {
  it('matches paths under a glob and rejects other extensions and roots', () => {
    const inScope = scope(['/data/**/*.txt']);
    expect(inScope('/data/a.txt')).toBe(true);
    expect(inScope('/data/deep/er/a.txt')).toBe(true);
    expect(inScope('/data/a.md')).toBe(false);
    expect(inScope('/elsewhere/a.txt')).toBe(false);
  });

  it('treats a bare directory as everything beneath it', () => {
    const inScope = scope(['/data']);
    expect(inScope('/data/x/y.bin')).toBe(true);
    expect(inScope('/datastore/y.bin')).toBe(false);
  });

  it('excludes a file matched by an ignored glob', () => {
    const inScope = scope(['/data/**'], ['**/*.tmp']);
    expect(inScope('/data/a.tmp')).toBe(false);
    expect(inScope('/data/a.txt')).toBe(true);
  });

  it('excludes files under an ignored directory even if the pattern names only the directory', () => {
    // chokidar prunes ignored directories, so their contents are never seen.
    const inScope = scope(['/data/**'], ['/data/node_modules']);
    expect(inScope('/data/node_modules/pkg/index.js')).toBe(false);
    expect(inScope('/data/src/index.js')).toBe(true);
  });

  it('matches ignored globs case-insensitively, like the watcher', () => {
    const inScope = scope(['/data/**'], ['**/Cache/**']);
    expect(inScope('/data/cache/x.json')).toBe(false);
    expect(inScope('/data/src/x.json')).toBe(true);
  });

  it('with multiple roots, matches any of them', () => {
    const inScope = scope(['/a/**/*.md', '/b/**/*.txt']);
    expect(inScope('/a/x.md')).toBe(true);
    expect(inScope('/b/x.txt')).toBe(true);
    expect(inScope('/a/x.txt')).toBe(false);
  });
});
