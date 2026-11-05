/**
 * @module watcher/FileSystemWatcher.reconcile.test
 * Reconciliation in `FileSystemWatcher` with the real chokidar source (D90, D91, D120, D128): a directory created after the initial scan is reconciled from the directory-create handler, a missed add returns through the stability wait and the normal handlers, a missed unlink is stat-confirmed, and the sink's root signals.
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  startWatcherHarness,
  waitFor,
  type WatcherHarness,
} from '../test/watcherHarness';
import { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';

let harness: WatcherHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** A harness reporting to a fresh change-source health tracker. */
async function start(files: Record<string, string> = {}) {
  const health = new ChangeSourceHealthTracker();
  harness = await startWatcherHarness({
    files,
    options: () => ({ changeSourceHealth: health }),
  });
  return { h: harness, health };
}

describe('FileSystemWatcher reconciliation', () => {
  it('reconciles a directory created after the initial scan (chokidar addDir)', async () => {
    const { h, health } = await start({ 'a.md': 'a' });
    expect(health.snapshot().lastReconcileAt).toBeNull();
    await mkdir(join(h.root, 'fresh'));
    await writeFile(join(h.root, 'fresh', 'n.md'), 'n');
    await waitFor(() => health.snapshot().lastReconcileAt !== null);
    await waitFor(() => h.seen().includes('create:fresh/n.md'));
    expect(health.snapshot().reconcileErrors).toBe(0);
  });

  it('enqueues a slowly written file in a new directory only after its writes end (D128)', async () => {
    const health = new ChangeSourceHealthTracker();
    harness = await startWatcherHarness({
      watch: (root) => ({
        paths: [`${root.replace(/\\/g, '/')}/**`],
        stabilityThresholdMs: 300,
      }),
      options: () => ({ changeSourceHealth: health }),
    });
    const h = harness;
    await mkdir(join(h.root, 'drop'));
    const path = join(h.root, 'drop', 'slow.md');
    for (let i = 0; i < 6; i++) {
      await appendFile(path, 'x'.repeat(1000));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const beforeEnd = h.seen().filter((s) => s === 'create:drop/slow.md');
    await waitFor(() => h.seen().includes('create:drop/slow.md'));
    expect(beforeEnd).toEqual([]);
    // Long enough for both chokidar's own add and the synthetic one.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(h.seen().filter((s) => s.endsWith('drop/slow.md'))).toEqual([
      'create:drop/slow.md',
    ]);
  });

  it('enqueues each file written slowly into a new directory exactly once', async () => {
    harness = await startWatcherHarness({
      watch: (root) => ({
        paths: [`${root.replace(/\\/g, '/')}/**`],
        stabilityThresholdMs: 200,
      }),
    });
    const h = harness;
    await mkdir(join(h.root, 'batch'));
    const names = Array.from({ length: 20 }, (_, i) => `f${String(i)}.md`);
    for (const name of names) {
      await writeFile(join(h.root, 'batch', name), name);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await waitFor(() => h.seen().length >= names.length);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect([...h.seen()].sort()).toEqual(
      names.map((name) => `create:batch/${name}`).sort(),
    );
  });

  it('adds a file whose event was missed, once, through the stability wait', async () => {
    const { h, health } = await start({ 'a.md': 'a', 'sub/b.md': 'b' });
    const missed = join(h.root, 'sub', 'b.md');
    h.watcher.inventory!.delete(missed); // as if its add never arrived
    h.watcher.rootAvailable(h.root);
    await waitFor(() => health.snapshot().reconcileEvents === 1);
    expect(h.seen().filter((s) => s === 'create:sub/b.md')).toHaveLength(2);
    expect(h.watcher.inventory!.get(missed)).toBeDefined();
    h.watcher.rootAvailable(h.root);
    await waitFor(() => health.snapshot().pendingStability === 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(health.snapshot().reconcileEvents).toBe(1);
  });

  it('reports a waiting synthetic path in pendingStability (D128)', async () => {
    const health = new ChangeSourceHealthTracker();
    harness = await startWatcherHarness({
      files: { 'a.md': 'a' },
      watch: (root) => ({
        paths: [`${root.replace(/\\/g, '/')}/**`],
        stabilityThresholdMs: 5000,
      }),
      options: () => ({ changeSourceHealth: health }),
    });
    const h = harness;
    h.watcher.inventory!.delete(join(h.root, 'a.md'));
    h.watcher.rootAvailable(h.root);
    await waitFor(() => health.snapshot().pendingStability === 1);
    expect(health.snapshot().reconcileEvents).toBe(0);
  });

  it('unlinks a file whose unlink was missed, confirmed by lstat', async () => {
    const { h, health } = await start({ 'a.md': 'a' });
    h.watcher.inventory!.set(join(h.root, 'ghost.md'));
    h.watcher.resubscribed(h.root);
    await waitFor(() => h.seen().includes('delete:ghost.md'));
    expect(health.snapshot()).toMatchObject({
      resubscribes: 1,
      reconcileEvents: 1,
    });
    expect(h.watcher.inventory!.get(join(h.root, 'ghost.md'))).toBeUndefined();
  });

  it('marks an unavailable root and skips its reconciles without unlinking', async () => {
    const { h, health } = await start({ 'a.md': 'a' });
    h.watcher.inventory!.set(join(h.root, 'ghost.md'));
    h.watcher.rootUnavailable(h.root, 'ENOENT');
    expect(health.snapshot().unavailableRoots).toBe(1);
    h.watcher.resubscribed(h.root);
    await waitFor(() => health.snapshot().reconcileErrors === 1);
    expect(h.seen()).not.toContain('delete:ghost.md');
    h.watcher.rootAvailable(h.root);
    await waitFor(() => h.seen().includes('delete:ghost.md'));
    expect(health.snapshot().unavailableRoots).toBe(0);
  });

  it('adds a missed file at the next periodic reconcile (D111)', async () => {
    const health = new ChangeSourceHealthTracker();
    harness = await startWatcherHarness({
      files: { 'a.md': 'a' },
      options: () => ({
        changeSourceHealth: health,
        getReconcileIntervalMs: () => 300,
      }),
    });
    const h = harness;
    h.watcher.inventory!.delete(join(h.root, 'a.md')); // as if never reported
    await waitFor(() => health.snapshot().reconcileEvents === 1);
    expect(h.seen()).toEqual(['create:a.md', 'create:a.md']);
  });

  it('never reconciles for a directory under the root .git or a root it does not watch', async () => {
    const { h, health } = await start({ 'a.md': 'a' });
    h.watcher.event('addDir', join(h.root, '.git', 'objects'));
    h.watcher.resubscribed(join(h.root, '..', 'not-a-root'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(health.snapshot()).toMatchObject({
      lastReconcileAt: null,
      resubscribes: 1,
    });
  });

  it('logs and drops a raw parcel batch (no parcel source in this build)', async () => {
    const { h } = await start();
    h.watcher.rawEvents(h.root, [
      { path: join(h.root, 'x.md'), type: 'create' },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.seen()).toEqual([]);
  });
});
