/**
 * @module app/watcherFactory.test
 * `watchConfigChanged`: which watch keys rebuild the watcher on a config reload (D100), compared by effective value; `reconcileIntervalMs` never does (D111). A rebuild to a parcel source that cannot load is refused before the running watcher stops (D125).
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { makeWatchConfig } from '../test/watchConfig';
import type { FileSystemWatcher } from '../watcher';
import type { JeevesWatcherFactories } from './factories';
import {
  loadSelectedChangeSource,
  rebuildWatcher,
  watchConfigChanged,
} from './watcherFactory';

describe('watchConfigChanged', () => {
  it('returns false when watch config is identical', () => {
    const cfg = makeWatchConfig();
    expect(watchConfigChanged(cfg, cfg)).toBe(false);
  });

  it('returns true when paths change', () => {
    const old = makeWatchConfig({ paths: ['**/*.md'] });
    const next = makeWatchConfig({ paths: ['**/*.ts'] });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('returns true when ignored changes', () => {
    const old = makeWatchConfig({ ignored: ['node_modules'] });
    const next = makeWatchConfig({ ignored: ['dist'] });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('returns true when respectGitignore changes', () => {
    const old = makeWatchConfig({ respectGitignore: true });
    const next = makeWatchConfig({ respectGitignore: false });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('returns true when moveDetection changes', () => {
    const old = makeWatchConfig({
      moveDetection: { enabled: false },
    } as never);
    const next = makeWatchConfig({
      moveDetection: { enabled: true },
    } as never);
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it.each([
    ['usePolling', true],
    ['pollIntervalMs', 250],
    ['stabilityThresholdMs', 0],
    ['changeSource', 'chokidar'],
  ] as const)('returns true when %s changes (D100)', (key, value) => {
    const old = makeWatchConfig();
    const next = makeWatchConfig({ [key]: value });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('compares effective values: a default spelled out is no change', () => {
    const old = makeWatchConfig();
    const next = makeWatchConfig({
      usePolling: false,
      pollIntervalMs: 1000,
      stabilityThresholdMs: 500,
      changeSource: 'parcel',
    });
    expect(watchConfigChanged(old, next)).toBe(false);
    expect(
      watchConfigChanged(
        makeWatchConfig({ changeSource: 'chokidar' }),
        makeWatchConfig({ changeSource: 'parcel' }),
      ),
    ).toBe(true);
  });

  it('ignores reconcileIntervalMs (applied without a rebuild, D111)', () => {
    const old = makeWatchConfig();
    const next = makeWatchConfig({ reconcileIntervalMs: 60_000 });
    expect(watchConfigChanged(old, next)).toBe(false);
  });
});

/** A watcher whose lifecycle calls are spies (returned beside it). */
function fakeWatcher() {
  const start = vi.fn(() => Promise.resolve());
  const stop = vi.fn(() => Promise.resolve());
  const watcher = { start, stop } as unknown as FileSystemWatcher;
  return { watcher, start, stop };
}

const failingImport = () =>
  Promise.reject(
    Object.assign(new Error('gone'), { code: 'MODULE_NOT_FOUND' }),
  );

describe('loadSelectedChangeSource', () => {
  it('imports parcel only when it is selected', async () => {
    const importParcel = vi.fn(() => Promise.resolve({ subscribe: vi.fn() }));
    await loadSelectedChangeSource(
      makeWatchConfig({ changeSource: 'chokidar' }).watch,
      importParcel,
    );
    await loadSelectedChangeSource(
      makeWatchConfig({ usePolling: true }).watch,
      importParcel,
    );
    expect(importParcel).not.toHaveBeenCalled();
    await loadSelectedChangeSource(makeWatchConfig().watch, importParcel);
    expect(importParcel).toHaveBeenCalledOnce();
  });

  it('rejects naming the switch when parcel cannot load', async () => {
    await expect(
      loadSelectedChangeSource(makeWatchConfig().watch, failingImport),
    ).rejects.toThrow('set watch.changeSource: chokidar');
  });
});

describe('rebuildWatcher', () => {
  const logger = pino({ level: 'silent' });

  it('refuses a rebuild to parcel that cannot load; the old watcher never stops (D125)', async () => {
    const old = fakeWatcher();
    const createFileSystemWatcher = vi.fn();
    const state = await rebuildWatcher(
      makeWatchConfig({ changeSource: 'parcel' }),
      { createFileSystemWatcher } as unknown as JeevesWatcherFactories,
      {} as never,
      {} as never,
      logger,
      {},
      { watcher: old.watcher },
      { importParcel: failingImport },
    );
    expect(state.watcher).toBe(old.watcher);
    expect(old.stop).not.toHaveBeenCalled();
    expect(createFileSystemWatcher).not.toHaveBeenCalled();
  });

  it('rebuilds to chokidar without importing parcel', async () => {
    const old = fakeWatcher();
    const next = fakeWatcher();
    const importParcel = vi.fn(failingImport);
    const state = await rebuildWatcher(
      makeWatchConfig({ changeSource: 'chokidar' }),
      {
        createFileSystemWatcher: () => next.watcher,
      } as unknown as JeevesWatcherFactories,
      {} as never,
      {} as never,
      logger,
      {},
      { watcher: old.watcher },
      { importParcel },
    );
    expect(state.watcher).toBe(next.watcher);
    expect(old.stop).toHaveBeenCalledOnce();
    expect(next.start).toHaveBeenCalledOnce();
    expect(importParcel).not.toHaveBeenCalled();
  });
});
