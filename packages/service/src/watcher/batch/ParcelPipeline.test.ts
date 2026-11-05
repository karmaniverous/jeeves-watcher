/**
 * @module watcher/batch/ParcelPipeline.test
 * The parcel batch pipeline with a fake disk (D127, D149, D179): batches held during a root's walk are classified against the full inventory, each kind goes to its handler, pairing runs only with move detection, and a 20K-file directory delete under a 120K-file inventory keeps the event loop responsive.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeDocumentKey } from '../../util/documentKey';
import type { RawChangeEvent } from '../changeSource/types';
import type { FilteredEvents } from '../filteredEvents';
import { Inventory } from '../inventory/Inventory';
import type { WatchFilter } from '../pathFilter';
import { WatchRoots } from '../roots';
import type { StabilityTicker } from '../stability/StabilityTicker';
import type { WalkedFile } from '../walk/Walker';
import type { PathState } from './classifyBatch';
import { lstatState, ParcelPipeline, type ParcelPipelineDeps } from './ParcelPipeline';

const ROOT = '/r';

/** A pipeline over a fake disk; handler calls are recorded. */
function setup(
  disk: Record<string, PathState> = {},
  overrides: Partial<ParcelPipelineDeps> = {},
) {
  const calls: string[] = [];
  const inventory = new Inventory(true);
  const filter = {
    globMatches: (path: string) => path.endsWith('.md'),
    isGitignored: () => false,
    isRootGit: () => false,
  } as unknown as WatchFilter;
  const events = {
    unlink: (path: string) => {
      inventory.delete(path);
      calls.push(`unlink ${path}`);
    },
    moved: (from: string, to: string) => {
      inventory.delete(from);
      inventory.set(to, { size: 1, mtimeMs: 1 });
      calls.push(`move ${from} -> ${to}`);
    },
  } as unknown as FilteredEvents;
  const ticker = {
    enter: (_key: string, path: string, synthetic: boolean) =>
      calls.push(`stability ${path}${synthetic ? ' synthetic' : ''}`),
    dropUnder: (dir: string) => calls.push(`drop ${dir}`),
  } as unknown as StabilityTicker;
  const walked = new Map<string, Map<string, WalkedFile>>();
  const pipeline = new ParcelPipeline({
    roots: new WatchRoots([ROOT]),
    filter,
    ignore: [(path) => path.includes('/node_modules')],
    inventory,
    events,
    ticker,
    reconcile: (dir) => calls.push(`reconcile ${dir}`),
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
    platform: 'linux',
    lstat: (path) => Promise.resolve(disk[path] ?? 'absent'),
    walk: (dir) => Promise.resolve(walked.get(dir) ?? new Map()),
    ...overrides,
  });
  return { pipeline, calls, inventory, walked };
}

const ev = (type: RawChangeEvent['type'], path: string): RawChangeEvent => ({ type, path });

describe('ParcelPipeline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a root\'s batches during its walk, then classifies them against the full inventory', async () => {
    const { pipeline, calls, inventory } = setup();
    pipeline.fifo.pause(ROOT);
    pipeline.push(ROOT, [ev('delete', '/r/a.md')]);
    await pipeline.fifo.idle();
    expect(calls).toEqual([]);
    inventory.set('/r/a.md', { size: 1, mtimeMs: 1 });
    pipeline.fifo.resume(ROOT);
    await pipeline.fifo.idle();
    expect(calls).toEqual(['drop /r/a.md', 'unlink /r/a.md']);
  });

  it('sends wanted files (and .gitignore) to the stability wait, not others', async () => {
    const { pipeline, calls } = setup({
      '/r/a.md': 'file',
      '/r/a.txt': 'file',
      '/r/sub/.gitignore': 'file',
    });
    pipeline.push(ROOT, [
      ev('create', '/r/a.md'),
      ev('create', '/r/a.txt'),
      ev('update', '/r/sub/.gitignore'),
      ev('create', '/r/node_modules/x.md'),
    ]);
    await pipeline.fifo.idle();
    expect(calls).toEqual(['stability /r/a.md', 'stability /r/sub/.gitignore']);
  });

  it('without move detection: directory delete unlinks each file, create reconciles, short names reconcile the parent', async () => {
    const { pipeline, calls, inventory } = setup(
      { '/r/new': 'dir' },
      { platform: 'win32' },
    );
    inventory.set('/r/old/a.md', { size: 1, mtimeMs: 1 });
    inventory.set('/r/old/b/c.md', { size: 1, mtimeMs: 1 });
    pipeline.push(ROOT, [
      ev('delete', '/r/old'),
      ev('create', '/r/new'),
      ev('delete', '/r/x/PROGRA~1'),
    ]);
    await pipeline.fifo.idle();
    expect(calls).toEqual([
      'drop /r/old',
      'unlink /r/old/a.md',
      'unlink /r/old/b/c.md',
      'reconcile /r/new',
      'reconcile /r/x',
    ]);
  });

  it('with move detection: a renamed directory becomes moves', async () => {
    const { pipeline, calls, inventory, walked } = setup(
      { '/r/new': 'dir' },
      { moveDetection: { enabled: true, bufferMs: 2000 } },
    );
    inventory.set('/r/old/a.md', { size: 1, mtimeMs: 1 });
    walked.set(
      '/r/new',
      new Map([[normalizeDocumentKey('/r/new/a.md'), { path: '/r/new/a.md', size: 1, mtimeMs: 2 }]]),
    );
    pipeline.push(ROOT, [ev('delete', '/r/old'), ev('create', '/r/new')]);
    await pipeline.fifo.idle();
    expect(calls).toContain('move /r/old/a.md -> /r/new/a.md');
    pipeline.stop();
  });

  it('buffers file events under a held create', async () => {
    vi.useFakeTimers();
    const { pipeline, calls } = setup(
      { '/r/new': 'dir', '/r/new/a.md': 'file' },
      { moveDetection: { enabled: true, bufferMs: 100 } },
    );
    pipeline.push(ROOT, [ev('create', '/r/new')]);
    pipeline.push(ROOT, [ev('create', '/r/new/a.md')]);
    await pipeline.fifo.idle();
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    await pipeline.fifo.idle();
    expect(calls).toEqual(['reconcile /r/new', 'stability /r/new/a.md']);
  });

  it('drops a batch whose root is gone, and batches for a stopped pipeline', async () => {
    const { pipeline, calls, inventory } = setup();
    inventory.set('/r/a.md', { size: 1, mtimeMs: 1 });
    pipeline.push(ROOT, [ev('delete', ROOT), ev('delete', '/r/a.md')]);
    await pipeline.fifo.idle();
    expect(calls).toEqual([]);
    pipeline.stop();
    pipeline.push(ROOT, [ev('delete', '/r/a.md')]);
    await pipeline.fifo.idle();
    expect(calls).toEqual([]);
  });

  it('a 20K-file directory delete under a 120K-file inventory keeps the loop delay under 100 ms (D149)', async () => {
    const { pipeline, inventory } = setup({}, {
      lstat: () => new Promise((resolve) => setImmediate(() => resolve('absent'))),
    });
    for (let i = 0; i < 100_000; i++) {
      inventory.set(`/r/keep/d${String(i % 500)}/f${String(i)}.md`, { size: 1, mtimeMs: 1 });
    }
    const batch: RawChangeEvent[] = [ev('delete', '/r/big')];
    for (let i = 0; i < 20_000; i++) {
      const path = `/r/big/d${String(i % 200)}/f${String(i)}.md`;
      inventory.set(path, { size: 1, mtimeMs: 1 });
      batch.push(ev('delete', path));
    }
    for (let d = 0; d < 200; d++) batch.push(ev('delete', `/r/big/d${String(d)}`));
    expect(inventory.size).toBe(120_000);
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    pipeline.push(ROOT, batch);
    await pipeline.fifo.idle();
    delay.disable();
    expect(inventory.size).toBe(100_000);
    expect(delay.max / 1e6).toBeLessThan(100);
  }, 60_000);
});

describe('lstatState', () => {
  it('reads files, directories and absence', async () => {
    await expect(lstatState(import.meta.filename)).resolves.toBe('file');
    await expect(lstatState(import.meta.dirname)).resolves.toBe('dir');
    await expect(lstatState(`${import.meta.dirname}/nope`)).resolves.toBe('absent');
    await expect(
      lstatState(`${import.meta.filename}/under-a-file`),
    ).resolves.toBe('absent');
  });
});
