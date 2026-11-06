/**
 * @module app/indexCheckAtStart.rebuild.test
 * A watcher rebuild that interrupts the index check (D197) does not cancel it for the process: the check runs again over the rebuilt watcher, at once when its initial scan already completed, else when it does. Shutdown waits for a hung check at most `shutdownTimeoutMs`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeSlashes } from '../util/normalizeSlashes';
import type { IndexCheckView } from '../watcher/indexCheck/view';
import { IndexCheckAtStart, type IndexCheckHost } from './indexCheckAtStart';

/** A host whose watcher can be swapped, over ten documents, one gone. */
function rebuildable(root: string, options: { shutdownTimeoutMs?: number }) {
  const payloads = [
    ...Array.from({ length: 9 }, (_, i) => ({
      file_path: `${root}/k${String(i)}.md`,
    })),
    { file_path: `${root}/gone.md` },
  ];
  let current = 0;
  const viewOf = (generation: number): IndexCheckView => ({
    roots: [root],
    skipReason: () => undefined,
    has: (path) => !path.endsWith('gone.md'),
    live: () => current === generation,
  });
  let releaseFirst: (() => void) | undefined;
  const firstPage = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const page = {
    points: payloads.map((payload, i) => ({ id: String(i), payload })),
  };
  const scrollPage = vi.fn(async () => {
    if (scrollPage.mock.calls.length === 1) await firstPage;
    return page;
  });
  const deleteFile = vi.fn(() => Promise.resolve());
  const warn = vi.fn();
  const logger = Object.assign(pino({ level: 'silent' }), { warn });
  const host = {
    config: { watch: { paths: [`${root}/**`] }, ...options },
    getFileSystemWatcher: () => ({ indexCheckView: viewOf(current) }),
    vectorStore: { scrollPage },
    processor: { deleteFile },
    logger,
  } as unknown as IndexCheckHost;
  return {
    check: new IndexCheckAtStart(() => host),
    rebuild: () => {
      current += 1;
    },
    releaseFirst: () => releaseFirst?.(),
    scrollPage,
    deleteFile,
    warn,
  };
}

describe('IndexCheckAtStart across a watcher rebuild', () => {
  let root: string;

  beforeEach(async () => {
    root = normalizeSlashes(await mkdtemp(join(tmpdir(), 'index-check-rb-')));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('runs again at once when the rebuilt watcher scanned while the check ran', async () => {
    const r = rebuildable(root, {});
    r.check.onInitialScanComplete();
    await vi.waitFor(() => {
      expect(r.scrollPage).toHaveBeenCalledTimes(1);
    });
    r.rebuild();
    r.check.onInitialScanComplete();
    r.releaseFirst();
    await vi.waitFor(() => {
      expect(r.check.snapshot().state).toBe('done');
    });
    expect(r.scrollPage).toHaveBeenCalledTimes(2);
    expect(r.deleteFile).toHaveBeenCalledTimes(1);
    expect(r.check.snapshot()).toMatchObject({ removed: 1 });
    await r.check.stop();
  });

  it('runs again after the rebuilt watcher scans, when the rebuild came first', async () => {
    const r = rebuildable(root, {});
    r.check.onInitialScanComplete();
    await vi.waitFor(() => {
      expect(r.scrollPage).toHaveBeenCalledTimes(1);
    });
    r.rebuild();
    r.releaseFirst();
    await vi.waitFor(() => {
      expect(r.check.snapshot().state).toBe('failed');
    });
    expect(r.deleteFile).not.toHaveBeenCalled();
    r.check.onInitialScanComplete();
    await vi.waitFor(() => {
      expect(r.check.snapshot().state).toBe('done');
    });
    expect(r.deleteFile).toHaveBeenCalledTimes(1);
    // Done: a later rebuild's scan does not run it again.
    r.rebuild();
    r.check.onInitialScanComplete();
    await r.check.stop();
    expect(r.scrollPage).toHaveBeenCalledTimes(2);
  });

  it('stops waiting for a hung check after shutdownTimeoutMs', async () => {
    const r = rebuildable(root, { shutdownTimeoutMs: 20 });
    r.check.onInitialScanComplete();
    await vi.waitFor(() => {
      expect(r.scrollPage).toHaveBeenCalledTimes(1);
    });
    // The first page never arrives.
    await r.check.stop();
    expect(r.warn).toHaveBeenCalledWith(
      { timeoutMs: 20, step: 'Index check stop' },
      'Index check stop timeout hit, forcing shutdown',
    );
    r.releaseFirst();
  });
});
