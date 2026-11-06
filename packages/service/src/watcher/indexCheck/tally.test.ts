/**
 * @module watcher/indexCheck/tally.test
 * The index check's per-root tally and cap (D197): roots matched by path segment, case-insensitively on Windows only (D195); source documents, points without a `file_path` and points outside every root ignored; candidates are the documents the inventory does not hold, kept up to one over the cap; the cap is more than 10% or more than 1,000.
 */

import { describe, expect, it } from 'vitest';

import { INDEX_CHECK_MAX_CANDIDATES, IndexCheckTally, overCap } from './tally';

const file = (path: string) => ({ file_path: path });

describe('overCap', () => {
  it.each([
    // candidates, indexed, capped
    [0, 0, false],
    [1, 10, false],
    [1, 9, true],
    [100, 1000, false],
    [101, 1000, true],
    [1000, 100_000, false],
    [1001, 100_000, true],
  ])(
    '%i candidates of %i indexed -> capped %s',
    (candidates, indexed, capped) => {
      expect(overCap(candidates, indexed)).toBe(capped);
    },
  );
});

describe('IndexCheckTally', () => {
  it('counts indexed documents per root and the candidates the inventory lacks', () => {
    const inventory = new Set(['/r/a.md', '/s/x.md']);
    const tally = new IndexCheckTally(
      ['/r', '/s'],
      (p) => inventory.has(p),
      'linux',
    );
    for (const p of ['/r/a.md', '/r/gone.md', '/s/x.md', '/s/sub/gone.md'])
      tally.add(file(p));
    expect(tally.results()).toEqual([
      { root: '/r', indexed: 2, candidates: 1, paths: ['/r/gone.md'] },
      { root: '/s', indexed: 2, candidates: 1, paths: ['/s/sub/gone.md'] },
    ]);
  });

  it('ignores source documents, points without a file_path and points outside every root', () => {
    const tally = new IndexCheckTally(['/r'], () => false, 'linux');
    tally.add({ source: 'app://chat/1' });
    tally.add({ source: 'app://chat/2', file_path: '' });
    tally.add({ file_path: 42 });
    tally.add({});
    tally.add(file('/rx/a.md'));
    tally.add(file('/other/a.md'));
    expect(tally.results()).toEqual([
      { root: '/r', indexed: 0, candidates: 0, paths: [] },
    ]);
  });

  it('counts a file point that also carries a rule-written source', () => {
    const tally = new IndexCheckTally(['/r'], () => false, 'linux');
    tally.add({ file_path: '/r/a.md', source: 'from-a-rule' });
    expect(tally.results()[0]).toMatchObject({ indexed: 1, candidates: 1 });
  });

  it('matches roots case-insensitively on Windows, with either slash', () => {
    const tally = new IndexCheckTally(['j:/docs'], () => false, 'win32');
    tally.add(file('J:\\Docs\\a.md'));
    tally.add(file('j:/DOCS/b.md'));
    tally.add(file('j:/docsx/c.md'));
    expect(tally.results()[0]).toMatchObject({
      indexed: 2,
      paths: ['J:\\Docs\\a.md', 'j:/DOCS/b.md'],
    });
  });

  it('keeps the written case on Linux and macOS (D195)', () => {
    for (const platform of ['linux', 'darwin']) {
      const tally = new IndexCheckTally(['/data/Docs'], () => false, platform);
      tally.add(file('/data/docs/a.md'));
      tally.add(file('/data/Docs/b.md'));
      expect(tally.results()[0]).toMatchObject({
        indexed: 1,
        paths: ['/data/Docs/b.md'],
      });
    }
  });

  it('matches a root given with a trailing slash, and the filesystem root', () => {
    const tally = new IndexCheckTally(['/r/'], () => false, 'linux');
    tally.add(file('/r/a.md'));
    expect(tally.results()[0]).toMatchObject({ root: '/r/', indexed: 1 });
    const whole = new IndexCheckTally(['/'], () => false, 'linux');
    whole.add(file('/a/b.md'));
    expect(whole.results()[0]).toMatchObject({ root: '/', indexed: 1 });
  });

  it('keeps candidate paths up to one over the cap but counts them all', () => {
    const tally = new IndexCheckTally(['/r'], () => false, 'linux');
    const total = INDEX_CHECK_MAX_CANDIDATES + 50;
    for (let i = 0; i < total; i++) tally.add(file(`/r/${String(i)}.md`));
    const [result] = tally.results();
    expect(result.candidates).toBe(total);
    expect(result.indexed).toBe(total);
    expect(result.paths).toHaveLength(INDEX_CHECK_MAX_CANDIDATES + 1);
  });
});
