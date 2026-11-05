/**
 * @module watcher/walk/Walker.test
 * The glob-aware walk on a temp directory: pruning, include-before-stat, stats, vanished entries, and a top-level failure.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeDocumentKey } from '../../util/documentKey';
import { normalizeSlashes } from '../../util/normalizeSlashes';
import { walk, type WalkFs } from './Walker';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jeeves-watcher-walk-'));
  await mkdir(join(root, 'sub', 'deep'), { recursive: true });
  await mkdir(join(root, 'skip'), { recursive: true });
  await writeFile(join(root, 'a.md'), 'aaa');
  await writeFile(join(root, 'b.txt'), 'b');
  await writeFile(join(root, 'sub', 'deep', 'c.md'), 'cc');
  await writeFile(join(root, 'skip', 'd.md'), 'd');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const isMd = (path: string) => path.endsWith('.md');
const rel = (path: string) =>
  normalizeSlashes(path).slice(normalizeSlashes(root).length + 1);

describe('walk', () => {
  it('returns included files with size and mtime, pruning directories', async () => {
    const found = await walk(root, {
      prune: (dir) => dir.endsWith('skip'),
      include: isMd,
    });
    expect([...found.values()].map((f) => rel(f.path)).sort()).toEqual([
      'a.md',
      'sub/deep/c.md',
    ]);
    const a = found.get(normalizeDocumentKey(join(root, 'a.md')));
    expect(a).toMatchObject({ size: 3 });
    expect(a?.mtimeMs).toBeGreaterThan(0);
  });

  it('checks include before stat, so rejected files cost no stat', async () => {
    const stat = vi.fn((path: string) =>
      import('node:fs/promises').then((fs) => fs.stat(path)),
    );
    const fs: WalkFs = {
      readdir: (dir) =>
        import('node:fs/promises').then((m) =>
          m.readdir(dir, { withFileTypes: true }),
        ),
      stat,
    };
    await walk(root, { prune: () => false, include: isMd, fs });
    expect(stat.mock.calls.map(([p]) => rel(p)).sort()).toEqual([
      'a.md',
      'skip/d.md',
      'sub/deep/c.md',
    ]);
  });

  it('rejects when the walked directory cannot be read', async () => {
    await expect(
      walk(join(root, 'missing'), { prune: () => false, include: isMd }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('skips entries that vanish beneath the walked directory', async () => {
    const real = await import('node:fs/promises');
    const fs: WalkFs = {
      readdir: (dir) =>
        dir.endsWith('deep')
          ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
          : real.readdir(dir, { withFileTypes: true }),
      stat: (path) =>
        path.endsWith('a.md')
          ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
          : real.stat(path),
    };
    const found = await walk(root, { prune: () => false, include: isMd, fs });
    expect([...found.values()].map((f) => rel(f.path))).toEqual(['skip/d.md']);
  });

  it('does not follow a symlinked directory', async () => {
    await import('node:fs/promises').then((fs) =>
      fs.symlink(join(root, 'sub'), join(root, 'link'), 'junction'),
    );
    const found = await walk(root, { prune: () => false, include: isMd });
    expect([...found.values()].map((f) => rel(f.path)).sort()).toEqual([
      'a.md',
      'skip/d.md',
      'sub/deep/c.md',
    ]);
  });
});
