/**
 * @module app/indexCheckAtStart.test
 * The index check runs once per process when the first initial scan completes (D197): not again for a scan reported during a run that ends `done` (rebuild cases: `indexCheckAtStart.rebuild.test.ts`), `off` (before and after the scan) when `watch.indexCheckOnStart` is false, deletes through the processor and the VCS hook, and stops on shutdown.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { normalizeSlashes } from '../util/normalizeSlashes';
import type { IndexCheckView } from '../watcher/indexCheck/view';
import { IndexCheckAtStart, type IndexCheckHost } from './indexCheckAtStart';

/** A root of ten indexed documents, one gone from disk and inventory. */
function fixture(options: { enabled?: boolean; root?: string } = {}) {
  const tmp = normalizeSlashes(
    options.root ?? join(tmpdir(), 'jeeves-watcher-no-such-root'),
  );
  const payloads = [
    ...Array.from({ length: 9 }, (_, i) => ({
      file_path: `${tmp}/k${String(i)}.md`,
    })),
    { file_path: `${tmp}/gone.md` },
  ];
  const view: IndexCheckView = {
    roots: [tmp],
    skipReason: () => undefined,
    has: (path) => !path.endsWith('gone.md'),
    live: () => true,
  };
  const deleteFile = vi.fn(() => Promise.resolve());
  const onFileChange = vi.fn();
  const scrollPage = vi.fn(() =>
    Promise.resolve({
      points: payloads.map((payload, i) => ({ id: String(i), payload })),
    }),
  );
  const host = {
    config: {
      watch: {
        paths: [`${tmp}/**`],
        ...(options.enabled === undefined
          ? {}
          : { indexCheckOnStart: options.enabled }),
      },
    },
    vectorStore: { scrollPage },
    processor: { deleteFile },
    vcsCoordinator: { onFileChange },
    logger: pino({ level: 'silent' }),
  } as unknown as IndexCheckHost;
  return { host, view, deleteFile, onFileChange, scrollPage };
}

/** Wait until the check has ended. */
async function settled(check: IndexCheckAtStart): Promise<void> {
  await vi.waitFor(() => {
    expect(['done', 'failed']).toContain(check.snapshot().state);
  });
}

/** An `IndexCheckAtStart` over the fixture's host. */
function create(host: IndexCheckHost) {
  return new IndexCheckAtStart(() => host);
}

describe('IndexCheckAtStart', () => {
  it('is pending, then runs once on the first scan, deleting through the processor and the VCS hook', async () => {
    const root = await mkdtemp(join(tmpdir(), 'index-check-app-'));
    try {
      const f = fixture({ root });
      const gone = `${normalizeSlashes(root)}/gone.md`;
      const check = create(f.host);
      expect(check.snapshot().state).toBe('pending');
      check.onInitialScanComplete(f.view);
      // A scan reported during a run that ends done does not run it again.
      check.onInitialScanComplete(f.view);
      await settled(check);
      expect(f.scrollPage).toHaveBeenCalledTimes(1);
      expect(f.onFileChange).toHaveBeenCalledWith(gone, 'unlink');
      expect(f.deleteFile).toHaveBeenCalledWith(gone);
      expect(check.snapshot()).toMatchObject({
        state: 'done',
        checked: 10,
        removed: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops on shutdown, mid-run, deleting nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'index-check-app-'));
    try {
      const f = fixture({ root });
      const check = create(f.host);
      check.onInitialScanComplete(f.view);
      await check.stop();
      expect(f.deleteFile).not.toHaveBeenCalled();
      expect(check.snapshot().state).toBe('failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips a root that is gone', async () => {
    const f = fixture();
    const check = create(f.host);
    check.onInitialScanComplete(f.view);
    await settled(check);
    expect(f.scrollPage).not.toHaveBeenCalled();
    expect(check.snapshot()).toMatchObject({
      state: 'done',
      skippedRoots: 1,
    });
  });

  it('reports off before and after the scan when disabled, and never lists', async () => {
    const f = fixture({ enabled: false });
    const check = create(f.host);
    expect(check.snapshot().state).toBe('off');
    check.onInitialScanComplete(f.view);
    await check.stop();
    expect(check.snapshot()).toMatchObject({ state: 'off', at: null });
    expect(f.scrollPage).not.toHaveBeenCalled();
  });

  it('runs when enabled explicitly', async () => {
    const f = fixture({ enabled: true });
    const check = create(f.host);
    expect(check.snapshot().state).toBe('pending');
    check.onInitialScanComplete(f.view);
    await settled(check);
    expect(check.snapshot().state).toBe('done');
  });

  it('does not start once the service is stopping', async () => {
    const f = fixture();
    const check = create(f.host);
    await check.stop();
    check.onInitialScanComplete(f.view);
    expect(check.snapshot().state).toBe('pending');
    expect(f.scrollPage).not.toHaveBeenCalled();
  });
});
