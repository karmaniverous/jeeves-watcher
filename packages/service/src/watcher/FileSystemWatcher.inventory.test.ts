/**
 * @module watcher/FileSystemWatcher.inventory.test
 * The inventory in `FileSystemWatcher` (D99) with the real chokidar source: filled by the initial scan, kept by live events, and rebuilt under a changed `.gitignore` without unlinks or adds.
 */

import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GitignoreFilter } from '../gitignore';
import {
  startWatcherHarness,
  waitFor,
  type WatcherHarness,
} from '../test/watcherHarness';
import { normalizeSlashes } from '../util/normalizeSlashes';

let harness: WatcherHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Inventory paths relative to the harness root, sorted. */
function inventoryOf(h: WatcherHarness): string[] {
  const base = normalizeSlashes(h.root).toLowerCase();
  return [...(h.watcher.inventory?.entriesUnder(h.root).keys() ?? [])]
    .map((key) => key.slice(base.length + 1))
    .sort();
}

describe('FileSystemWatcher inventory (D99)', () => {
  it('holds the matched files of the initial scan and follows live events', async () => {
    harness = await startWatcherHarness({
      files: { 'a.md': 'a', 'sub/b.md': 'b', 'c.txt': 'c' },
      watch: (root) => ({ paths: [`${normalizeSlashes(root)}/**/*.md`] }),
    });
    expect(inventoryOf(harness)).toEqual(['a.md', 'sub/b.md']);
    await harness.write('sub/n.md');
    await waitFor(() => inventoryOf(harness!).includes('sub/n.md'));
    await unlink(join(harness.root, 'a.md'));
    await waitFor(() => !inventoryOf(harness!).includes('a.md'));
    expect(inventoryOf(harness)).toEqual(['sub/b.md', 'sub/n.md']);
  });

  it('drops newly gitignored files and re-adds them when the pattern goes, emitting nothing', async () => {
    harness = await startWatcherHarness({
      files: { '.gitignore': '', 'docs/a.md': 'a', 'docs/b.md': 'b' },
      watch: (root) => ({ paths: [`${normalizeSlashes(root)}/**/*.md`] }),
      options: (root) => ({ gitignoreFilter: new GitignoreFilter([root]) }),
    });
    const queued = harness.events.length;
    await writeFile(join(harness.root, '.gitignore'), 'docs/a.md\n');
    await waitFor(() => !inventoryOf(harness!).includes('docs/a.md'));
    expect(inventoryOf(harness)).toEqual(['docs/b.md']);
    await writeFile(join(harness.root, '.gitignore'), '');
    await waitFor(() => inventoryOf(harness!).includes('docs/a.md'));
    expect(harness.events.length).toBe(queued);
  });
});
