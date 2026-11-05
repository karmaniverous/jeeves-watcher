/**
 * @module watcher/indexCheck/view.test
 * The index check's view of a running watcher (D197): skip reasons in order (unavailable D109, unwatched D156, start walk failed), inventory membership by point-ID key, and the live flag; plus the view `FileSystemWatcher` builds over the real parcel source.
 */

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  startWatcherHarness,
  type WatcherHarness,
} from '../../test/watcherHarness';
import { Inventory } from '../inventory/Inventory';
import { WatchRoots } from '../roots';
import { indexCheckView } from './view';

function running() {
  const inventory = new Inventory(false);
  inventory.set('/r/A.md');
  return {
    roots: new WatchRoots(['/r', '/s']),
    inventory,
    unavailableRoots: new Set<string>(),
    unwatchedRoots: new Set<string>(),
    walkFailedRoots: new Set<string>(),
  };
}

describe('indexCheckView', () => {
  it('reports each skip reason, unavailable first', () => {
    const r = running();
    const view = indexCheckView(r, () => true);
    expect(view.roots).toEqual(['/r', '/s']);
    expect(view.skipReason('/r')).toBeUndefined();
    r.walkFailedRoots.add('/r');
    expect(view.skipReason('/r')).toBe('walkFailed');
    r.unwatchedRoots.add('/r');
    expect(view.skipReason('/r')).toBe('unwatched');
    r.unavailableRoots.add('/r');
    expect(view.skipReason('/r')).toBe('unavailable');
    expect(view.skipReason('/s')).toBeUndefined();
  });

  it('answers inventory membership by key (any case) and the live flag', () => {
    let live = true;
    const view = indexCheckView(running(), () => live);
    expect(view.has('/r/A.md')).toBe(true);
    expect(view.has('/r/a.md')).toBe(true);
    expect(view.has('/r/b.md')).toBe(false);
    expect(view.live()).toBe(true);
    live = false;
    expect(view.live()).toBe(false);
  });
});

describe('FileSystemWatcher.indexCheckView (parcel source)', () => {
  let harness: WatcherHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('follows root signals and goes stale on stop', async () => {
    harness = await startWatcherHarness({
      files: { 'a.md': 'a' },
      watch: () => ({ changeSource: 'parcel' }),
    });
    const h = harness;
    const view = h.watcher.indexCheckView;
    if (!view) throw new Error('no view after start');
    const [root] = view.roots;
    expect(view.has(join(h.root, 'a.md'))).toBe(true);
    expect(view.skipReason(root)).toBeUndefined();
    h.watcher.rootUnavailable(h.root, 'ENOSPC', { reachable: true });
    expect(view.skipReason(root)).toBe('unwatched');
    h.watcher.rootAvailable(h.root);
    expect(view.skipReason(root)).toBeUndefined();
    h.watcher.rootUnavailable(h.root, 'ENOENT');
    expect(view.skipReason(root)).toBe('unavailable');
    expect(view.live()).toBe(true);
    await h.watcher.stop();
    expect(view.live()).toBe(false);
    expect(h.watcher.indexCheckView).toBeUndefined();
  });
});
