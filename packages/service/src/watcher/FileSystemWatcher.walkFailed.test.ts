/**
 * @module watcher/FileSystemWatcher.walkFailed.test
 * A root whose start walk fails is marked for the index check (D197): its inventory is incomplete, so `indexCheckView.skipReason` answers `walkFailed` once the initial scan is done. The walker is mocked to fail; the parcel source is real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startWatcherHarness,
  type WatcherHarness,
} from '../test/watcherHarness';
import type * as WalkerModule from './walk/Walker';

vi.mock('./walk/Walker', async (importOriginal) => {
  const actual = await importOriginal<typeof WalkerModule>();
  return {
    ...actual,
    walk: () => Promise.reject(new Error('EACCES: permission denied')),
  };
});

describe('FileSystemWatcher: a failed start walk (parcel source)', () => {
  let harness: WatcherHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('marks the root walk-failed for the index check', async () => {
    harness = await startWatcherHarness({
      files: { 'a.md': 'a' },
      watch: () => ({ changeSource: 'parcel' }),
    });
    const view = harness.watcher.indexCheckView;
    if (!view) throw new Error('no view after start');
    const [root] = view.roots;
    await vi.waitFor(() => {
      expect(view.skipReason(root)).toBe('walkFailed');
    });
  });
});
