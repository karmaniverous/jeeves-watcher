/**
 * @module watcher/FileSystemWatcher.parcel.heavy.test
 * Directory moves and deletes at the spec's 1,000 files over the real `@parcel/watcher` (D62, D127). In the serial `heavy` vitest project.
 */

import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  eventsOf as of,
  fileTree as tree,
  startWatcherHarness,
  waitFor,
  type WatcherHarness,
} from '../test/watcherHarness';

/** Files in the directory-move tests (spec: 1,000). */
const TREE = 1000;

describe('FileSystemWatcher (parcel source) at 1,000 files', () => {
  let harness: WatcherHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
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
});
