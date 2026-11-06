/**
 * @module app/indexCheckAtStart.rebuild.test
 * A watcher rebuild that interrupts the index check (D197) does not cancel it for the process: the check runs again over the watcher that reported the next initial scan (not the app's current watcher, which a reload swaps late), at once when that scan already completed, else when it does, and never over a watcher rebuilt again before its scan. A stop during the hand-off ends it. Shutdown waits for a hung check at most `shutdownTimeoutMs` and reports it still running.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeSlashes } from '../util/normalizeSlashes';
import type { IndexCheckView } from '../watcher/indexCheck/view';
import { IndexCheckAtStart, type IndexCheckHost } from './indexCheckAtStart';

/**
 * A rebuildable watcher over ten documents, one gone. Each scan signal
 * carries the view of the watcher that completed it; the host holds no
 * watcher (the app swaps its own only after a reload's reindex).
 */
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
    vectorStore: { scrollPage },
    processor: { deleteFile },
    logger,
  } as unknown as IndexCheckHost;
  const check = new IndexCheckAtStart(() => host);
  return {
    check,
    /** The current watcher completes its initial scan. */
    scan: () => {
      check.onInitialScanComplete(viewOf(current));
    },
    rebuild: () => {
      current += 1;
    },
    releaseFirst: () => releaseFirst?.(),
    /** Wait until the first run is listing. */
    listing: () =>
      vi.waitFor(() => {
        expect(scrollPage).toHaveBeenCalledTimes(1);
      }),
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

  it('runs again at once over the rebuilt watcher that scanned while the check ran', async () => {
    const r = rebuildable(root, {});
    r.scan();
    await r.listing();
    r.rebuild();
    r.scan();
    r.releaseFirst();
    await vi.waitFor(() => {
      expect(r.check.snapshot().state).toBe('done');
    });
    expect(r.scrollPage).toHaveBeenCalledTimes(2);
    expect(r.deleteFile).toHaveBeenCalledTimes(1);
    expect(r.check.snapshot()).toMatchObject({ removed: 1 });
    expect(await r.check.stop()).toBe(true);
  });

  it('runs again after the rebuilt watcher scans, when the rebuild came first', async () => {
    const r = rebuildable(root, {});
    r.scan();
    await r.listing();
    r.rebuild();
    r.releaseFirst();
    await vi.waitFor(() => {
      expect(r.check.snapshot().state).toBe('failed');
    });
    expect(r.deleteFile).not.toHaveBeenCalled();
    r.scan();
    await vi.waitFor(() => {
      expect(r.check.snapshot().state).toBe('done');
    });
    expect(r.deleteFile).toHaveBeenCalledTimes(1);
    // Done: a later rebuild's scan does not run it again.
    r.rebuild();
    r.scan();
    await r.check.stop();
    expect(r.scrollPage).toHaveBeenCalledTimes(2);
  });

  it('waits for the next scan when the watcher that scanned was rebuilt again', async () => {
    const r = rebuildable(root, {});
    r.scan();
    await r.listing();
    r.rebuild();
    r.scan();
    // Rebuilt again before the stale run ends: its scan is not done yet.
    r.rebuild();
    r.releaseFirst();
    await vi.waitFor(() => {
      expect(r.check.snapshot().state).toBe('failed');
    });
    expect(r.scrollPage).toHaveBeenCalledTimes(1);
    // No run was started over the watcher rebuilt away (one interruption).
    const interrupted = () =>
      r.warn.mock.calls.filter(([, msg]) =>
        String(msg).includes('interrupted by a watcher rebuild'),
      ).length;
    expect(interrupted()).toBe(1);
    r.scan();
    await vi.waitFor(() => {
      expect(r.check.snapshot().state).toBe('done');
    });
    expect(r.scrollPage).toHaveBeenCalledTimes(2);
    expect(r.deleteFile).toHaveBeenCalledTimes(1);
    expect(interrupted()).toBe(1);
    await r.check.stop();
  });

  it('does not run again when the service stops as the interrupted run ends', async () => {
    const r = rebuildable(root, {});
    r.scan();
    await r.listing();
    r.rebuild();
    r.scan();
    const stopped = r.check.stop();
    r.releaseFirst();
    expect(await stopped).toBe(true);
    expect(r.scrollPage).toHaveBeenCalledTimes(1);
    expect(r.check.snapshot().state).toBe('failed');
  });

  it('stops waiting for a hung check after shutdownTimeoutMs, reporting it still running', async () => {
    const r = rebuildable(root, { shutdownTimeoutMs: 20 });
    r.scan();
    await r.listing();
    // The first page never arrives.
    expect(await r.check.stop()).toBe(false);
    expect(r.warn).toHaveBeenCalledWith(
      { timeoutMs: 20, step: 'Index check stop' },
      'Index check stop timeout hit, forcing shutdown',
    );
    r.releaseFirst();
  });
});
