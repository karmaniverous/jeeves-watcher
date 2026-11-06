/**
 * @module watcher/indexCheck/runIndexCheck.test
 * The index check at start (D197), over a fake index and view: stat-confirmed deletes through the delete-event path (VCS hook, then the processor's delete), the inventory re-check after the stat, removed totals, the running state, skipped roots (unavailable, unwatched, walk failed, gone), the per-root cap, source documents and points outside the roots untouched, paging, listing failure, stopping and the stale outcome of a rebuild.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHUNK0_FILTER, runIndexCheck } from './runIndexCheck';
import { file, kept, PAD, setup } from './runIndexCheck.fixtures';
import { INDEX_CHECK_MAX_CANDIDATES } from './tally';

afterEach(() => {
  vi.useRealTimers();
});

describe('runIndexCheck', () => {
  it('deletes gone files through the VCS hook, then the processor, and reports done', async () => {
    const pad = kept('/r');
    const { deps, calls, health, store } = setup({
      inventory: pad.paths,
      gone: ['/r/gone.md'],
      payloads: [...pad.payloads, file('/r/gone.md')],
    });
    await runIndexCheck(deps);
    expect(calls).toEqual(['vcs unlink /r/gone.md', 'delete /r/gone.md']);
    expect(store.scrollPage).toHaveBeenCalledWith(
      CHUNK0_FILTER,
      1000,
      undefined,
      ['file_path'],
    );
    expect(health.snapshot()).toMatchObject({
      state: 'done',
      checked: PAD + 1,
      removed: 1,
      skippedRoots: 0,
      capped: 0,
    });
    expect(health.snapshot().at).not.toBeNull();
  });

  it('leaves a candidate still on disk, and one an event added meanwhile', async () => {
    const pads = [kept('/r'), kept('/r/more')];
    const s = setup({
      inventory: pads.flatMap((p) => p.paths),
      gone: ['/r/added.md'],
      payloads: [
        ...pads.flatMap((p) => p.payloads),
        file('/r/present.md'),
        file('/r/added.md'),
      ],
    });
    s.deps.isGone = (path) => {
      if (path === '/r/present.md') {
        // The event for added.md lands while present.md is stat-checked.
        s.inventory.add('/r/added.md');
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    };
    await runIndexCheck(s.deps);
    expect(s.calls).toEqual([]);
    expect(s.health.snapshot()).toMatchObject({
      checked: 2 * PAD + 2,
      removed: 0,
      capped: 0,
    });
  });

  it('keeps a file an event re-adds while its own stat is in flight', async () => {
    const pad = kept('/r');
    const s = setup({
      inventory: pad.paths,
      payloads: [...pad.payloads, file('/r/back.md')],
    });
    s.deps.isGone = (path) => {
      // The file is re-created and its add lands before the stat answers.
      s.inventory.add(path);
      return Promise.resolve(true);
    };
    await runIndexCheck(s.deps);
    expect(s.calls).toEqual([]);
    expect(s.health.snapshot()).toMatchObject({ removed: 0, capped: 0 });
  });

  it('deletes nothing once the service stops during a stat', async () => {
    let stopping = false;
    const pad = kept('/r');
    const s = setup({
      inventory: pad.paths,
      payloads: [...pad.payloads, file('/r/gone.md')],
      stopped: () => stopping,
    });
    s.deps.isGone = () => {
      stopping = true;
      return Promise.resolve(true);
    };
    expect(await runIndexCheck(s.deps)).toBe('failed');
    expect(s.calls).toEqual([]);
  });

  it('totals removed documents across roots and within one', async () => {
    const a = [kept('/a'), kept('/a/more')];
    const b = kept('/b');
    const gone = ['/a/g1.md', '/a/g2.md', '/b/g.md'];
    const { deps, calls, health } = setup({
      roots: ['/a', '/b'],
      inventory: [...a.flatMap((p) => p.paths), ...b.paths],
      gone,
      payloads: [
        ...a.flatMap((p) => p.payloads),
        ...b.payloads,
        ...gone.map(file),
      ],
    });
    await runIndexCheck(deps);
    expect(calls.filter((c) => c.startsWith('delete'))).toEqual(
      gone.map((g) => `delete ${g}`),
    );
    expect(health.snapshot()).toMatchObject({
      state: 'done',
      checked: 3 * PAD + 3,
      removed: 3,
      capped: 0,
    });
  });

  it('reports running while it works, and its duration when done', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T00:00:00.000Z'));
    const pad = kept('/r');
    const s = setup({
      inventory: pad.paths,
      gone: ['/r/gone.md'],
      payloads: [...pad.payloads, file('/r/gone.md')],
    });
    let during: string | undefined;
    s.deps.deleteFile = () => {
      during = s.health.snapshot().state;
      vi.setSystemTime(new Date('2026-11-06T00:00:00.250Z'));
      return Promise.resolve();
    };
    expect(await runIndexCheck(s.deps)).toBe('done');
    expect(during).toBe('running');
    expect(s.health.snapshot()).toMatchObject({
      state: 'done',
      durationMs: 250,
      at: '2026-11-06T00:00:00.250Z',
    });
  });

  it('skips unavailable, unwatched, walk-failed and gone roots, touching nothing under them', async () => {
    const roots = ['/a', '/b', '/c', '/d', '/e'];
    const pads = roots.map(kept);
    const { deps, calls, health } = setup({
      roots,
      skip: { '/a': 'unavailable', '/b': 'unwatched', '/c': 'walkFailed' },
      goneRoots: ['/d'],
      inventory: pads.flatMap((p) => p.paths),
      gone: roots.map((r) => `${r}/x.md`),
      payloads: [
        ...pads.flatMap((p) => p.payloads),
        ...roots.map((r) => file(`${r}/x.md`)),
      ],
    });
    await runIndexCheck(deps);
    expect(calls).toEqual(['vcs unlink /e/x.md', 'delete /e/x.md']);
    expect(health.snapshot()).toMatchObject({
      state: 'done',
      checked: PAD + 1,
      removed: 1,
      skippedRoots: 4,
    });
  });

  it('deletes nothing under a root over the cap, and still checks the others', async () => {
    const capped = Array.from({ length: 10 }, (_, i) => `/r/${String(i)}.md`);
    const { deps, calls, health } = setup({
      roots: ['/r', '/s'],
      inventory: capped.slice(0, 8),
      gone: [...capped, '/s/gone.md'],
      payloads: [
        ...capped.map(file),
        ...Array.from({ length: 9 }, (_, i) => file(`/s/${String(i)}.md`)),
        file('/s/gone.md'),
      ],
    });
    deps.view = {
      ...deps.view,
      has: (path) => !path.endsWith('gone.md') && !/\/r\/[89]\.md$/.test(path),
    };
    await runIndexCheck(deps);
    expect(calls).toEqual(['vcs unlink /s/gone.md', 'delete /s/gone.md']);
    expect(health.snapshot()).toMatchObject({
      checked: 20,
      removed: 1,
      capped: 1,
    });
  });

  it('caps a root with more than 1,000 candidates however large it is', async () => {
    const n = INDEX_CHECK_MAX_CANDIDATES + 1;
    const paths = Array.from({ length: n }, (_, i) => `/r/${String(i)}.md`);
    const { deps, calls, health } = setup({
      gone: paths,
      payloads: [
        ...paths.map(file),
        ...Array.from({ length: 20 * n }, (_, i) => file(`/r/k${String(i)}`)),
      ],
    });
    deps.view = { ...deps.view, has: (path) => path.startsWith('/r/k') };
    await runIndexCheck(deps);
    expect(calls).toEqual([]);
    expect(health.snapshot()).toMatchObject({ capped: 1, removed: 0 });
  });

  it('never touches source documents or points outside the roots', async () => {
    const { deps, calls, health } = setup({
      gone: ['/elsewhere/a.md', 'app://chat/1'],
      payloads: [
        { source: 'app://chat/1' },
        file('/elsewhere/a.md'),
        file('/rx/a.md'),
      ],
    });
    await runIndexCheck(deps);
    expect(calls).toEqual([]);
    expect(health.snapshot()).toMatchObject({ checked: 0, removed: 0 });
  });

  it('pages through the index with the page size and cursor', async () => {
    const payloads = Array.from({ length: 5 }, (_, i) =>
      file(`/r/${String(i)}.md`),
    );
    const { deps, store, health } = setup({
      inventory: payloads.map((p) => String(p.file_path)),
      payloads,
      pageSize: 2,
    });
    await runIndexCheck(deps);
    expect(store.scrollPage.mock.calls.map((c) => c[2])).toEqual([
      undefined,
      2,
      4,
    ]);
    expect(health.snapshot()).toMatchObject({ state: 'done', checked: 5 });
  });

  it('lists nothing when no root can be checked', async () => {
    const { deps, store, health } = setup({
      skip: { '/r': 'unavailable' },
      payloads: [file('/r/a.md')],
    });
    await runIndexCheck(deps);
    expect(store.scrollPage).not.toHaveBeenCalled();
    expect(health.snapshot()).toMatchObject({ state: 'done', skippedRoots: 1 });
  });

  it('fails, deleting nothing, when the index cannot be listed', async () => {
    vi.useFakeTimers();
    const { deps, calls, health } = setup({
      gone: ['/r/a.md'],
      payloads: [],
    });
    deps.vectorStore = {
      scrollPage: vi.fn(() => Promise.reject(new Error('qdrant down'))),
    };
    const run = runIndexCheck(deps);
    await vi.runAllTimersAsync();
    await run;
    expect(calls).toEqual([]);
    expect(health.snapshot()).toMatchObject({ state: 'failed', removed: 0 });
  });

  it('stops before listing or deleting more once the service stops or the watcher is rebuilt', async () => {
    let stopping = false;
    const pad = [...kept('/r').payloads, ...kept('/r/more').payloads];
    const stopped = setup({
      inventory: pad.map((p) => String(p.file_path)),
      gone: ['/r/a.md', '/r/b.md'],
      payloads: [...pad, file('/r/a.md'), file('/r/b.md')],
      stopped: () => stopping,
    });
    stopped.deps.deleteFile = vi.fn(() => {
      stopping = true;
      return Promise.resolve();
    });
    // The service stopping is a failure, not a rebuild.
    expect(await runIndexCheck(stopped.deps)).toBe('failed');
    expect(stopped.deps.deleteFile).toHaveBeenCalledTimes(1);
    expect(stopped.health.snapshot()).toMatchObject({ state: 'failed' });

    const rebuilt = setup({
      gone: ['/r/a.md'],
      payloads: [file('/r/a.md')],
      live: () => false,
    });
    // A rebuild while the service runs on: the next watcher's check.
    expect(await runIndexCheck(rebuilt.deps)).toBe('stale');
    expect(rebuilt.store.scrollPage).not.toHaveBeenCalled();
    expect(rebuilt.calls).toEqual([]);
    expect(rebuilt.health.snapshot()).toMatchObject({ state: 'failed' });
  });
});
