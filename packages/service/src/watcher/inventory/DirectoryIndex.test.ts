/**
 * @module watcher/inventory/DirectoryIndex.test
 * The child-set directory index (D127, D150): linking, unlinking with empty-directory pruning, and O(subtree) enumeration.
 */

import { describe, expect, it } from 'vitest';

import { DirectoryIndex, parentKey } from './DirectoryIndex';

describe('parentKey', () => {
  it.each([
    ['c:/a/b.md', 'c:/a'],
    ['c:/a', 'c:'],
    ['c:', undefined],
    ['/tmp/a', '/tmp'],
    ['/tmp', undefined],
  ])('%s -> %s', (key, parent) => {
    expect(parentKey(key)).toBe(parent);
  });
});

describe('DirectoryIndex', () => {
  it('indexes every ancestor directory of a file', () => {
    const index = new DirectoryIndex();
    index.addFile('/r/a/b/c.md');
    expect(['/r', '/r/a', '/r/a/b'].map((d) => index.has(d))).toEqual([
      true,
      true,
      true,
    ]);
    expect(index.has('/r/a/b/c.md')).toBe(false);
  });

  it('enumerates a subtree at any depth, each file once', () => {
    const index = new DirectoryIndex();
    for (const key of ['/r/a/1', '/r/a/x/2', '/r/a/x/y/3', '/r/b/4']) {
      index.addFile(key);
    }
    expect([...index.filesUnder('/r/a')].sort()).toEqual([
      '/r/a/1',
      '/r/a/x/2',
      '/r/a/x/y/3',
    ]);
    expect([...index.filesUnder('/r/none')]).toEqual([]);
  });

  it('drops directories left empty, up the chain, and keeps shared ones', () => {
    const index = new DirectoryIndex();
    index.addFile('/r/a/x/1');
    index.addFile('/r/a/2');
    index.removeFile('/r/a/x/1');
    expect(index.has('/r/a/x')).toBe(false);
    expect(index.has('/r/a')).toBe(true);
    index.removeFile('/r/a/2');
    expect(index.has('/r/a')).toBe(false);
    expect(index.has('/r')).toBe(false);
  });

  it('ignores removing a file it never held', () => {
    const index = new DirectoryIndex();
    index.addFile('/r/a/1');
    index.removeFile('/r/b/2');
    index.removeFile('/r/a/9');
    expect([...index.filesUnder('/r')]).toEqual(['/r/a/1']);
  });

  it('visits each directory of a 1,000 x 10 tree once (D150)', () => {
    const index = new DirectoryIndex();
    for (let d = 0; d < 1000; d++) {
      for (let f = 0; f < 10; f++) {
        index.addFile(`/r/t/d${String(d)}/f${String(f)}`);
      }
    }
    for (let i = 0; i < 20_000; i++) index.addFile(`/r/other/o${String(i)}`);
    const files = [...index.filesUnder('/r/t')];
    expect(files).toHaveLength(10_000);
    expect(new Set(files).size).toBe(10_000);
  });
});
