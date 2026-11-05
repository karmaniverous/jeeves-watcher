/**
 * @module watcher/initialWalk.test
 * The walk-based initial set (D58, D126): every walked file is added with its stats, roots finish in turn, a missing root is logged and still finishes, a stopped watcher stops adding, and the Linux watch-budget warning fires above 90% of `max_user_watches`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  INITIAL_WALK_CHUNK,
  initialWalk,
  maxUserWatches,
  walkRoots,
  warnWatchBudget,
} from './initialWalk';
import type { WalkedFile } from './walk/Walker';

const logger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() });

/** A fake walker: `dirs` directories, `files` files per root. */
function fakeWalk(files: Record<string, number>, dirs = 3) {
  return vi.fn(
    (root: string, options: { onDirectory?: (dir: string) => void }) => {
      if (!(root in files)) return Promise.reject(new Error('ENOENT'));
      for (let d = 0; d < dirs; d++)
        options.onDirectory?.(`${root}/d${String(d)}`);
      const found = new Map<string, WalkedFile>();
      for (let i = 0; i < files[root]; i++) {
        const path = `${root}/f${String(i)}.md`;
        found.set(path, { path, size: i, mtimeMs: 10 });
      }
      return Promise.resolve(found);
    },
  );
}

const filters = { prune: () => false, include: () => true };

describe('initialWalk', () => {
  it('adds every file with its stats, yielding between chunks', async () => {
    const add = vi.fn();
    const count = INITIAL_WALK_CHUNK + 5;
    const dirs = await initialWalk('/r', {
      events: { add },
      filters,
      logger: logger() as never,
      live: () => true,
      walk: fakeWalk({ '/r': count }),
    });
    expect(dirs).toBe(3);
    expect(add).toHaveBeenCalledTimes(count);
    expect(add).toHaveBeenCalledWith('/r/f1.md', { size: 1, mtimeMs: 10 });
  });

  it('logs a root it cannot walk and reports no directories', async () => {
    const log = logger();
    await expect(
      initialWalk('/missing', {
        events: { add: vi.fn() },
        filters,
        logger: log as never,
        live: () => true,
        walk: fakeWalk({}),
      }),
    ).resolves.toBe(0);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('stops adding once the watcher stopped', async () => {
    const add = vi.fn();
    let live = true;
    add.mockImplementation(() => {
      live = false;
    });
    await initialWalk('/r', {
      events: { add },
      filters,
      logger: logger() as never,
      live: () => live,
      walk: fakeWalk({ '/r': 10 }),
    });
    expect(add).toHaveBeenCalledOnce();
  });
});

describe('walkRoots', () => {
  it('walks roots in turn, finishing each, then checks the Linux watch budget', async () => {
    const done: string[] = [];
    const log = logger();
    await walkRoots({
      roots: ['/a', '/b', '/missing'],
      events: { add: vi.fn() },
      filters,
      logger: log as never,
      live: () => true,
      onRootDone: (root) => done.push(root),
      platform: 'linux',
      readMaxUserWatches: () => Promise.resolve(6),
      walk: fakeWalk({ '/a': 1, '/b': 1 }),
    });
    expect(done).toEqual(['/a', '/b', '/missing']);
    expect(log.warn).toHaveBeenCalledWith(
      { directories: 6, maxUserWatches: 6 },
      expect.stringContaining('max_user_watches'),
    );
  });

  it('skips the budget check off Linux and stops when the watcher stopped', async () => {
    const read = vi.fn();
    const done: string[] = [];
    await walkRoots({
      roots: ['/a'],
      events: { add: vi.fn() },
      filters,
      logger: logger() as never,
      live: () => true,
      onRootDone: (root) => done.push(root),
      platform: 'win32',
      readMaxUserWatches: read,
    });
    expect(read).not.toHaveBeenCalled();
    await walkRoots({
      roots: ['/a'],
      events: { add: vi.fn() },
      filters,
      logger: logger() as never,
      live: () => false,
      onRootDone: (root) => done.push(root),
      platform: 'linux',
      readMaxUserWatches: read,
    });
    expect(done).toEqual(['/a']);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('warnWatchBudget', () => {
  it.each([
    [89, 100, false],
    [90, 100, false],
    [91, 100, true],
    [1_000_000, undefined, false],
  ])('%d directories against %s -> %s', (dirs, limit, warned) => {
    const log = logger();
    expect(warnWatchBudget(dirs, limit, log as never)).toBe(warned);
    expect(log.warn).toHaveBeenCalledTimes(warned ? 1 : 0);
  });
});

describe('maxUserWatches', () => {
  it('reads the proc value, or undefined', async () => {
    await expect(maxUserWatches(() => Promise.resolve('8192\n'))).resolves.toBe(
      8192,
    );
    await expect(
      maxUserWatches(() => Promise.resolve('junk')),
    ).resolves.toBeUndefined();
    await expect(
      maxUserWatches(() => Promise.reject(new Error('ENOENT'))),
    ).resolves.toBeUndefined();
  });

  it('reads the real proc file by default', async () => {
    const value = await maxUserWatches();
    expect(value !== undefined && value > 0).toBe(process.platform === 'linux');
  });
});
