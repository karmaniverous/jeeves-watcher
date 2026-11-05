/**
 * @module watcher/FileSystemWatcher.parcel.test
 * `FileSystemWatcher` over the real `@parcel/watcher` (C2, C3) on this platform (Windows and Linux CI): the walk-based initial set (D58), add/change/unlink through the stability wait, no-op attribute changes (D142), directory renames as moves and deletes as unlinks (D62, D127), no subtree reconcile for directory attribute changes (D179), and the root's `.git` never producing events (D152).
 */

import {
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startWatcherHarness,
  waitFor,
  type WatcherHarness,
} from '../test/watcherHarness';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';
import { FileSystemWatcher } from './index';

/** Files in the directory-move tests (spec: 1,000). */
const TREE = 1000;

/** The relative paths of one event type, in order. */
function of(h: WatcherHarness, type: string): string[] {
  const prefix = `${type}:`;
  return h
    .seen()
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length));
}

/** `count` files under `dir` (`f0.md` ...), nested two levels. */
function tree(dir: string, count: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    files[`${dir}/d${String(i % 10)}/f${String(i)}.md`] =
      `content ${String(i)}`;
  }
  return files;
}

describe('FileSystemWatcher (parcel source, real filesystem)', () => {
  let harness: WatcherHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('walks the initial set, then follows add, change and unlink', async () => {
    const changeSourceHealth = new ChangeSourceHealthTracker();
    harness = await startWatcherHarness({
      files: { 'a.md': 'a', 'sub/b.md': 'b' },
      watch: () => ({ changeSource: 'parcel' }),
      options: () => ({ changeSourceHealth }),
    });
    const h = harness;
    expect(of(h, 'create').sort()).toEqual(['a.md', 'sub/b.md']);
    expect(changeSourceHealth.snapshot().source).toBe('parcel');
    await h.write('c.md', 'c');
    await waitFor(() => of(h, 'create').includes('c.md'));
    await h.write('a.md', 'a changed');
    await waitFor(() => of(h, 'modify').includes('a.md'));
    await rm(join(h.root, 'sub', 'b.md'));
    await waitFor(() => of(h, 'delete').includes('sub/b.md'));
    expect(h.watcher.getWatchedFiles()).toHaveLength(2);
  });

  it('drops an attribute change that leaves size and mtime alone (D142)', async () => {
    harness = await startWatcherHarness({
      files: { 'a.md': 'a' },
      watch: () => ({ changeSource: 'parcel', stabilityThresholdMs: 0 }),
    });
    const h = harness;
    const path = join(h.root, 'a.md');
    await chmod(path, 0o444);
    await chmod(path, 0o666);
    const marker = await h.write('marker.md', 'm');
    await waitFor(() => of(h, 'create').includes('marker.md'));
    expect(marker).toContain('marker.md');
    expect(of(h, 'modify')).toEqual([]);
  });

  it('pairs a 1,000-file directory rename as moves, both ways (D62)', async () => {
    harness = await startWatcherHarness({
      files: tree('zeta', TREE),
      watch: () => ({
        changeSource: 'parcel',
        moveDetection: { enabled: true, bufferMs: 2000 },
      }),
    });
    const h = harness;
    const createdAtStart = of(h, 'create').length;
    expect(createdAtStart).toBe(TREE);
    await rename(join(h.root, 'zeta'), join(h.root, 'alpha'));
    await waitFor(() => of(h, 'move').length >= TREE, 30_000);
    await rename(join(h.root, 'alpha'), join(h.root, 'zeta'));
    await waitFor(() => of(h, 'move').length >= TREE * 2, 30_000);
    expect(of(h, 'move')).toHaveLength(TREE * 2);
    expect(of(h, 'create')).toHaveLength(createdAtStart);
    expect(of(h, 'delete')).toEqual([]);
    expect(h.watcher.getWatchedFiles()).toHaveLength(TREE);
  }, 90_000);

  it('turns a 1,000-file directory delete into 1,000 unlinks (D127)', async () => {
    harness = await startWatcherHarness({
      files: tree('gone', TREE),
      watch: () => ({
        changeSource: 'parcel',
        moveDetection: { enabled: true, bufferMs: 200 },
      }),
    });
    const h = harness;
    await rm(join(h.root, 'gone'), { recursive: true, force: true });
    await waitFor(() => of(h, 'delete').length >= TREE, 30_000);
    expect(of(h, 'delete')).toHaveLength(TREE);
    expect(h.watcher.getWatchedFiles()).toEqual([]);
  }, 60_000);

  it('reconciles a new directory without pairing (moveDetection off)', async () => {
    harness = await startWatcherHarness({
      watch: () => ({ changeSource: 'parcel' }),
    });
    const h = harness;
    await mkdir(join(h.root, 'fresh', 'deep'), { recursive: true });
    await writeFile(join(h.root, 'fresh', 'deep', 'x.md'), 'x');
    await waitFor(() => of(h, 'create').includes('fresh/deep/x.md'));
    await rm(join(h.root, 'fresh'), { recursive: true });
    await waitFor(() => of(h, 'delete').includes('fresh/deep/x.md'));
    expect(of(h, 'create')).toEqual(['fresh/deep/x.md']);
  });

  it('does not reconcile a tree whose directories only changed attributes (D179)', async () => {
    const changeSourceHealth = new ChangeSourceHealthTracker();
    harness = await startWatcherHarness({
      files: tree('t', 50),
      watch: () => ({ changeSource: 'parcel', stabilityThresholdMs: 0 }),
      options: () => ({ changeSourceHealth }),
    });
    const h = harness;
    const now = new Date();
    for (let i = 0; i < 10; i++) {
      const dir = join(h.root, 't', `d${String(i)}`);
      await chmod(dir, 0o755);
      await utimes(dir, now, now);
    }
    await h.write('marker.md', 'm');
    await waitFor(() => of(h, 'create').includes('marker.md'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(changeSourceHealth.snapshot().lastReconcileAt).toBeNull();
    expect(of(h, 'create')).toHaveLength(51);
  });

  it("never turns the root's .git into events, even when watch.ignored omits it (D152)", async () => {
    harness = await startWatcherHarness({
      watch: () => ({ changeSource: 'parcel', ignored: [] }),
    });
    const h = harness;
    await mkdir(join(h.root, '.git', 'objects'), { recursive: true });
    for (let i = 0; i < 20; i++) {
      await writeFile(join(h.root, '.git', 'objects', `o${String(i)}`), 'x');
    }
    await h.write('marker.md', 'm');
    await waitFor(() => of(h, 'create').includes('marker.md'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(of(h, 'create')).toEqual(['marker.md']);
  });

  it('a reachable but unwatched root counts as unavailable and is still reconciled (D156)', async () => {
    const changeSourceHealth = new ChangeSourceHealthTracker();
    harness = await startWatcherHarness({
      watch: () => ({ changeSource: 'parcel' }),
      options: () => ({ changeSourceHealth }),
    });
    const h = harness;
    h.watcher.rootUnavailable(h.root, 'ENOSPC', { reachable: true });
    expect(changeSourceHealth.snapshot().unavailableRoots).toBe(1);
    h.watcher.resubscribed(h.root);
    await waitFor(() => changeSourceHealth.snapshot().lastReconcileAt !== null);
    expect(changeSourceHealth.snapshot().reconcileErrors).toBe(0);
  });

  it('a gone root is not reconciled until it is back (D109)', async () => {
    const changeSourceHealth = new ChangeSourceHealthTracker();
    harness = await startWatcherHarness({
      watch: () => ({ changeSource: 'parcel' }),
      options: () => ({ changeSourceHealth }),
    });
    const h = harness;
    h.watcher.rootUnavailable(h.root, 'ENOENT');
    h.watcher.resubscribed(h.root);
    await waitFor(() => changeSourceHealth.snapshot().reconcileErrors === 1);
    expect(changeSourceHealth.snapshot().lastReconcileAt).toBeNull();
    h.watcher.rootAvailable(h.root);
    await waitFor(() => changeSourceHealth.snapshot().lastReconcileAt !== null);
    expect(changeSourceHealth.snapshot().unavailableRoots).toBe(0);
  });

  it('never imports parcel when chokidar is selected', async () => {
    const importParcel = vi.fn();
    harness = await startWatcherHarness({
      options: () => ({ importParcel }),
    });
    expect(importParcel).not.toHaveBeenCalled();
  });

  it('rejects start, naming the switch, when parcel cannot load (D125)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jeeves-watcher-noparcel-'));
    try {
      const watcher = new FileSystemWatcher(
        {
          paths: [`${normalizeSlashes(root)}/**`],
          ignored: [],
          changeSource: 'parcel',
        },
        { enqueue: vi.fn(), start: vi.fn() } as never,
        {} as never,
        pino({ level: 'silent' }),
        {
          importParcel: () =>
            Promise.reject(
              Object.assign(new Error('x'), { code: 'MODULE_NOT_FOUND' }),
            ),
        },
      );
      await expect(watcher.start()).rejects.toThrow(
        'set watch.changeSource: chokidar',
      );
      await watcher.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
