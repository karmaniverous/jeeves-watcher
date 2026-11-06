/**
 * @module watcher/indexCheck/runIndexCheck.test
 * The index check at start (D197), over a fake index and view: stat-confirmed deletes through the delete-event path (VCS hook, then the processor's delete), the inventory re-check, skipped roots (unavailable, unwatched, walk failed, gone), the per-root cap, source documents and points outside the roots untouched, paging, listing failure and stopping; plus the default `lstat` checks on a real directory.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IndexCheckHealthTracker } from './IndexCheckHealthTracker';
import {
  CHUNK0_FILTER,
  type IndexCheckDeps,
  runIndexCheck,
} from './runIndexCheck';
import { INDEX_CHECK_MAX_CANDIDATES } from './tally';
import type { IndexCheckSkipReason, IndexCheckView } from './view';

type Payload = Record<string, unknown>;

/** A fake index answering pages of `size` from `payloads`. */
function fakeStore(payloads: Payload[], size = 1000) {
  return {
    scrollPage: vi.fn(
      (
        _filter: Record<string, unknown> | undefined,
        limit: number | undefined,
        offset?: string | number,
      ) => {
        const pageSize = limit ?? size;
        const start = typeof offset === 'number' ? offset : 0;
        const points = payloads
          .slice(start, start + pageSize)
          .map((payload, i) => ({ id: String(start + i), payload }));
        const next = start + pageSize;
        return Promise.resolve({
          points,
          nextCursor: next < payloads.length ? next : undefined,
        });
      },
    ),
  };
}

interface Setup {
  roots?: string[];
  inventory?: string[];
  gone?: string[];
  goneRoots?: string[];
  skip?: Record<string, IndexCheckSkipReason>;
  payloads: Payload[];
  pageSize?: number;
  live?: () => boolean;
  stopped?: () => boolean;
}

function setup(s: Setup) {
  const inventory = new Set(s.inventory ?? []);
  const gone = new Set(s.gone ?? []);
  const calls: string[] = [];
  const view: IndexCheckView = {
    roots: s.roots ?? ['/r'],
    skipReason: (root) => s.skip?.[root],
    has: (path) => inventory.has(path),
    live: s.live ?? (() => true),
  };
  const health = new IndexCheckHealthTracker();
  const store = fakeStore(s.payloads);
  const deps: IndexCheckDeps = {
    view,
    vectorStore: store,
    deleteFile: vi.fn((path: string) => {
      calls.push(`delete ${path}`);
      return Promise.resolve();
    }),
    onVcsFileChange: vi.fn((path: string, event: string) => {
      calls.push(`vcs ${event} ${path}`);
    }),
    health,
    logger: pino({ level: 'silent' }),
    stopped: s.stopped,
    isGone: (path) => Promise.resolve(gone.has(path)),
    rootGone: (root) => Promise.resolve((s.goneRoots ?? []).includes(root)),
    platform: 'linux',
    pageSize: s.pageSize,
  };
  return { deps, calls, health, store, inventory };
}

const file = (path: string): Payload => ({ file_path: path });

/** Kept documents per root, so one candidate stays within the 10% cap. */
const PAD = 9;

/** `PAD` documents under `root` the inventory holds. */
function kept(root: string): { paths: string[]; payloads: Payload[] } {
  const paths = Array.from(
    { length: PAD },
    (_, i) => `${root}/kept${String(i)}.md`,
  );
  return { paths, payloads: paths.map(file) };
}

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
    await runIndexCheck(stopped.deps);
    expect(stopped.deps.deleteFile).toHaveBeenCalledTimes(1);
    expect(stopped.health.snapshot()).toMatchObject({ state: 'failed' });

    const rebuilt = setup({
      gone: ['/r/a.md'],
      payloads: [file('/r/a.md')],
      live: () => false,
    });
    await runIndexCheck(rebuilt.deps);
    expect(rebuilt.store.scrollPage).not.toHaveBeenCalled();
    expect(rebuilt.calls).toEqual([]);
    expect(rebuilt.health.snapshot()).toMatchObject({ state: 'failed' });
  });
});

describe('runIndexCheck on a real directory (default lstat checks)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('deletes a file that is gone, keeps one on disk, and skips a missing root', async () => {
    dir = await mkdtemp(join(tmpdir(), 'index-check-'));
    await writeFile(join(dir, 'here.md'), 'x');
    const missingRoot = `${dir}-missing`;
    const pads = [kept(dir), kept(join(dir, 'sub'))];
    const s = setup({
      roots: [dir, missingRoot],
      inventory: pads.flatMap((p) => p.paths),
      payloads: [
        ...pads.flatMap((p) => p.payloads),
        file(join(dir, 'here.md')),
        file(join(dir, 'gone.md')),
        file(join(missingRoot, 'a.md')),
      ],
    });
    delete s.deps.isGone;
    delete s.deps.rootGone;
    s.deps.platform = process.platform;
    await runIndexCheck(s.deps);
    expect(s.calls).toEqual([
      `vcs unlink ${join(dir, 'gone.md')}`,
      `delete ${join(dir, 'gone.md')}`,
    ]);
    expect(s.health.snapshot()).toMatchObject({
      checked: 2 * PAD + 2,
      removed: 1,
      skippedRoots: 1,
    });
  });
});
