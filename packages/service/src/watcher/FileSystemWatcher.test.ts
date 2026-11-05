/**
 * @module watcher/FileSystemWatcher.test
 * `FileSystemWatcher` with the real chokidar source on a temp directory: initial scan, live add/change/unlink, glob, `watch.ignored` and gitignore filtering, VCS hook, stop.
 */

import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitignoreFilter } from '../gitignore';
import {
  startWatcherHarness,
  waitFor,
  type WatcherHarness,
} from '../test/watcherHarness';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';

let harness: WatcherHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('FileSystemWatcher (chokidar source, real filesystem)', () => {
  it('enqueues every matched file of the initial scan and completes it', async () => {
    const onInitialScanComplete = vi.fn();
    harness = await startWatcherHarness({
      files: { 'a.md': 'a', 'sub/b.md': 'b', 'c.txt': 'c' },
      watch: (root) => ({ paths: [`${normalizeSlashes(root)}/**/*.md`] }),
      options: () => ({ onInitialScanComplete }),
    });
    expect(harness.seen().sort()).toEqual(['create:a.md', 'create:sub/b.md']);
    expect(harness.tracker.getStatus()).toMatchObject({
      active: false,
      filesMatched: 2,
      filesEnqueued: 2,
    });
    expect(onInitialScanComplete).toHaveBeenCalledTimes(1);
    expect(harness.vcs.sort()).toEqual(['add:a.md', 'add:sub/b.md']);
  });

  it('maps live add, change and unlink to create, modify and delete', async () => {
    harness = await startWatcherHarness();
    const path = await harness.write('n.md', 'one');
    await waitFor(() => harness!.seen().includes('create:n.md'));
    await writeFile(path, 'two, longer');
    await waitFor(() => harness!.seen().includes('modify:n.md'));
    await unlink(path);
    await waitFor(() => harness!.seen().includes('delete:n.md'));
    expect(harness.vcs).toEqual(['add:n.md', 'change:n.md', 'unlink:n.md']);
  });

  it('drops glob-rejected, ignored and gitignored files', async () => {
    harness = await startWatcherHarness({
      files: { '.gitignore': 'skip.md\n', 'skip.md': 's', 'keep.md': 'k' },
      watch: (root) => ({
        paths: [`${normalizeSlashes(root)}/**/*.md`],
        ignored: ['**/junk/**'],
      }),
      options: (root) => ({ gitignoreFilter: new GitignoreFilter([root]) }),
    });
    expect(harness.seen()).toEqual(['create:keep.md']);
    await harness.write('junk/j.md');
    await harness.write('other.txt');
    await harness.write('late.md');
    await waitFor(() => harness!.seen().includes('create:late.md'));
    expect(harness.seen()).toEqual(['create:keep.md', 'create:late.md']);
  });

  it('re-reads a changed .gitignore before filtering later events', async () => {
    harness = await startWatcherHarness({
      files: { '.gitignore': '' },
      watch: (root) => ({ paths: [`${normalizeSlashes(root)}/**`] }),
      options: (root) => ({ gitignoreFilter: new GitignoreFilter([root]) }),
    });
    await writeFile(join(harness.root, '.gitignore'), 'hidden.md\n');
    await waitFor(() => harness!.seen().includes('modify:.gitignore'));
    await harness.write('hidden.md');
    await harness.write('shown.md');
    await waitFor(() => harness!.seen().includes('create:shown.md'));
    expect(harness.seen()).not.toContain('create:hidden.md');
  });

  it('reports the chokidar source to health.changeSource (D157)', async () => {
    const changeSourceHealth = new ChangeSourceHealthTracker();
    changeSourceHealth.setUnavailable('/stale', true);
    harness = await startWatcherHarness({
      options: () => ({ changeSourceHealth }),
    });
    expect(changeSourceHealth.snapshot()).toMatchObject({
      source: 'chokidar',
      unavailableRoots: 0,
      pendingStability: 0,
      lastRenewDurationMs: null,
    });
  });

  it('drops change and unlink events the filters reject', async () => {
    harness = await startWatcherHarness({
      files: { '.gitignore': 'hidden.md\n' },
      watch: (root) => ({ paths: [`${normalizeSlashes(root)}/**/*.md`] }),
      options: (root) => ({ gitignoreFilter: new GitignoreFilter([root]) }),
    });
    const at = (p: string) => join(harness!.root, p);
    harness.watcher.event('change', at('x.txt'));
    harness.watcher.event('change', at('hidden.md'));
    harness.watcher.event('unlink', at('x.txt'));
    harness.watcher.event('unlink', at('hidden.md'));
    harness.watcher.event('unlinkDir', at('gone'));
    expect(harness.seen()).toEqual([]);
  });

  it('emits at once with a stability threshold of 0', async () => {
    harness = await startWatcherHarness({
      watch: () => ({ stabilityThresholdMs: 0 }),
    });
    await harness.write('z.md');
    await waitFor(() => harness!.seen().includes('create:z.md'));
    expect(harness.seen()).toEqual(['create:z.md']);
  });

  it('tracks processing health: success, failure, and stop at the retry limit', async () => {
    const onFatalError = vi.fn();
    const processFile = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('boom'));
    harness = await startWatcherHarness({
      files: { 'a.md': 'a' },
      processor: { processFile } as never,
      options: () => ({ maxRetries: 1, maxBackoffMs: 1, onFatalError }),
    });
    const [job] = harness.jobs;
    await job();
    expect(processFile).toHaveBeenCalledOnce();
    await job();
    expect(onFatalError).toHaveBeenCalledOnce();
    expect(harness.watcher.getWatchedFiles()).toEqual([]);
  });

  it('records a change-source error as a system failure', async () => {
    harness = await startWatcherHarness();
    const source = (
      harness.watcher as unknown as {
        running: {
          source: { watcher: { emit: (e: string, x: unknown) => void } };
        };
      }
    ).running.source;
    source.watcher.emit('error', new Error('EPERM'));
    expect(harness.watcher.systemHealth.currentBackoffMs).toBeGreaterThan(0);
  });

  it('stops watching on stop', async () => {
    harness = await startWatcherHarness({ files: { 'a.md': 'a' } });
    expect(harness.watcher.getWatchedFiles().length).toBeGreaterThan(0);
    await harness.watcher.stop();
    expect(harness.watcher.getWatchedFiles()).toEqual([]);
    await mkdir(join(harness.root, 'later'));
    await harness.write('later/z.md');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(harness.seen()).toEqual(['create:a.md']);
    await rm(join(harness.root, 'later'), { recursive: true });
  });
});
