/**
 * @module watcher/FileSystemWatcher.parcel.recovery.test
 * Recovery over the real `@parcel/watcher`: an error delivered to the real subscription resubscribes and the reconcile restores what the gap missed (D131); on Linux, a root deleted and re-created is unavailable then reconciled with nothing unlinked (D109), a renewal makes a renamed directory's subtree live again (D129, D176), and an ignored directory gets no inotify watches (D126).
 */

import { readdirSync, readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
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
import {
  loadParcelWatcher,
  type ParcelCallback,
  type ParcelWatcherModule,
} from './changeSource/parcelModule';
import { ParcelSource } from './changeSource/ParcelSource';
import type { ChangeSink, RawChangeEvent } from './changeSource/types';
import { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';

const linux = process.platform === 'linux';

/** The relative paths of one event type. */
function of(h: WatcherHarness, type: string): string[] {
  const prefix = `${type}:`;
  return h
    .seen()
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length));
}

/** The real module, with the latest subscription callback exposed. */
async function tappedParcel() {
  const real = await loadParcelWatcher();
  const tap: { callback?: ParcelCallback } = {};
  const parcel: ParcelWatcherModule = {
    subscribe: (dir, callback, options) => {
      tap.callback = callback;
      return real.subscribe(dir, callback, options);
    },
  };
  return { parcel, tap };
}

/** Inotify watches this process holds (Linux `/proc/self/fdinfo`). */
function inotifyWatches(): number {
  let count = 0;
  for (const fd of readdirSync('/proc/self/fdinfo')) {
    try {
      const info = readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8');
      count += info
        .split('\n')
        .filter((l) => l.startsWith('inotify wd:')).length;
    } catch {
      // The fd closed meanwhile.
    }
  }
  return count;
}

describe('FileSystemWatcher (parcel) recovery, real filesystem', () => {
  let harness: WatcherHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('resubscribes after a subscription error and reconciles the gap (D131)', async () => {
    const { parcel, tap } = await tappedParcel();
    const changeSourceHealth = new ChangeSourceHealthTracker();
    harness = await startWatcherHarness({
      files: { 'a.md': 'a' },
      watch: () => ({ changeSource: 'parcel' }),
      options: () => ({
        changeSourceHealth,
        importParcel: () => Promise.resolve(parcel),
      }),
    });
    const h = harness;
    tap.callback?.(new Error('injected subscription error'), []);
    await h.write('gap.md', 'written while unsubscribed');
    await waitFor(
      () => changeSourceHealth.snapshot().resubscribes === 1,
      10_000,
    );
    await waitFor(() => of(h, 'create').includes('gap.md'), 10_000);
    expect(changeSourceHealth.snapshot().unavailableRoots).toBe(0);
    expect(of(h, 'delete')).toEqual([]);
  });

  it.runIf(linux)(
    'a deleted root is unavailable, nothing is unlinked, and it is reconciled when back (D109)',
    async () => {
      const changeSourceHealth = new ChangeSourceHealthTracker();
      harness = await startWatcherHarness({
        files: { 'a.md': 'a', 'sub/b.md': 'b' },
        watch: () => ({ changeSource: 'parcel' }),
        options: () => ({ changeSourceHealth }),
      });
      const h = harness;
      await rm(h.root, { recursive: true, force: true });
      await waitFor(
        () => changeSourceHealth.snapshot().unavailableRoots === 1,
        10_000,
      );
      await mkdir(join(h.root, 'sub'), { recursive: true });
      await writeFile(join(h.root, 'c.md'), 'c');
      await waitFor(
        () => changeSourceHealth.snapshot().unavailableRoots === 0,
        15_000,
      );
      await waitFor(() => of(h, 'create').includes('c.md'), 10_000);
      expect(of(h, 'delete')).toEqual([]);
    },
    40_000,
  );

  it.runIf(linux)(
    'a renewal makes a renamed directory live again (D129, D176)',
    async () => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), 'parcel-renew-')),
      );
      const state = await mkdtemp(join(tmpdir(), 'parcel-renew-state-'));
      await mkdir(join(root, 'a', 'deep'), { recursive: true });
      const seen: RawChangeEvent[] = [];
      const sink = {
        rawEvents: (_root: string, events: RawChangeEvent[]) =>
          seen.push(...events),
        rootUnavailable: vi.fn(),
        rootAvailable: vi.fn(),
        resubscribed: vi.fn(),
      } as unknown as ChangeSink;
      const source = new ParcelSource({
        parcel: await loadParcelWatcher(),
        ignored: [],
        stateDir: state,
        logger: pino({ level: 'silent' }),
      });
      try {
        await source.start([root], [], sink);
        await rename(join(root, 'a'), join(root, 'b'));
        await new Promise((resolve) => setTimeout(resolve, 200));
        await expect(source.renew(root)).resolves.toMatchObject({
          rebuilt: false,
        });
        const target = join(root, 'b', 'deep', 'after-renew.md');
        await writeFile(target, 'x');
        await waitFor(() => seen.some((e) => e.path === target), 10_000);
      } finally {
        await source.stop();
        await rm(root, { recursive: true, force: true });
        await rm(state, { recursive: true, force: true });
      }
    },
  );

  it.runIf(linux)(
    'adds no inotify watch under an ignored directory (D126)',
    async () => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), 'parcel-ignore-')),
      );
      for (let i = 0; i < 40; i++) {
        await mkdir(join(root, 'skip', `d${String(i)}`), { recursive: true });
      }
      await mkdir(join(root, 'keep'));
      const parcel = await loadParcelWatcher();
      const before = inotifyWatches();
      const source = new ParcelSource({
        parcel,
        ignored: ['skip/**', join(root, 'skip')],
        stateDir: root,
        logger: pino({ level: 'silent' }),
      });
      try {
        await source.start([root], [], {
          rawEvents: vi.fn(),
        } as unknown as ChangeSink);
        expect(inotifyWatches() - before).toBeLessThan(10);
      } finally {
        await source.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
