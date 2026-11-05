/**
 * @module watcher/pairing/DirectoryPairing.test
 * Order-independent directory pairing (C3, D62, D149, D150): both orders, the 90% rule, unmatched files, buffered events under Q, cancelled stability waits, and unpaired holds resolving at `bufferMs`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeDocumentKey } from '../../util/documentKey';
import type { WalkedFile } from '../walk/Walker';
import { DirectoryPairing, type PairingDeps } from './DirectoryPairing';

const BUFFER_MS = 2000;

/** A fake world: an inventory, a disk to walk, and recorded handler calls. */
function world() {
  const inventory = new Map<string, { path: string; size: number }>();
  const disk = new Map<string, Map<string, WalkedFile>>();
  const calls: string[] = [];
  const queued: (() => Promise<void> | void)[] = [];
  const deps: PairingDeps = {
    bufferMs: BUFFER_MS,
    entriesUnder: (dir) => {
      const prefix = `${normalizeDocumentKey(dir)}/`;
      return new Map([...inventory].filter(([key]) => key.startsWith(prefix)));
    },
    forget: (path) => {
      inventory.delete(normalizeDocumentKey(path));
    },
    walk: (dir) => Promise.resolve(disk.get(dir) ?? new Map()),
    unlink: (path) => calls.push(`unlink ${path}`),
    move: (from, to, stats) =>
      calls.push(`move ${from} -> ${to} ${String(stats.size)}`),
    enterStability: (path) => calls.push(`stability ${path}`),
    dropStability: (dir) => calls.push(`drop ${dir}`),
    reconcile: (dir) => calls.push(`reconcile ${dir}`),
    schedule: (work) => queued.push(work),
    logger: { info: vi.fn(), warn: vi.fn() } as never,
  };
  const file = (path: string, size = 1) =>
    inventory.set(normalizeDocumentKey(path), { path, size });
  const onDisk = (dir: string, files: Record<string, number>) => {
    disk.set(
      dir,
      new Map(
        Object.entries(files).map(([path, size]) => [
          normalizeDocumentKey(path),
          { path, size, mtimeMs: 7 },
        ]),
      ),
    );
  };
  /** Run the timers' queued work, as the FIFO would. */
  const drain = async () => {
    for (let work = queued.shift(); work; work = queued.shift()) await work();
  };
  return { deps, calls, inventory, file, onDisk, drain };
}

describe('DirectoryPairing', () => {
  let w: ReturnType<typeof world>;
  let pairing: DirectoryPairing;

  beforeEach(() => {
    vi.useFakeTimers();
    w = world();
    pairing = new DirectoryPairing(w.deps);
    w.file('/r/old/a.md', 1);
    w.file('/r/old/sub/b.md', 2);
    w.onDisk('/r/new', { '/r/new/a.md': 1, '/r/new/sub/b.md': 2 });
  });

  afterEach(() => {
    pairing.stop();
    vi.useRealTimers();
  });

  it('pairs delete-then-create into per-file moves', async () => {
    await pairing.deleted('/r/old');
    expect(w.inventory.size).toBe(0);
    await pairing.created('/r/new');
    expect(w.calls).toEqual([
      'drop /r/old',
      'drop /r/new',
      'move /r/old/a.md -> /r/new/a.md 1',
      'move /r/old/sub/b.md -> /r/new/sub/b.md 2',
    ]);
    expect(pairing.held).toEqual({ deletes: 0, creates: 0 });
    await vi.advanceTimersByTimeAsync(BUFFER_MS);
    await w.drain();
    expect(w.calls).toHaveLength(4);
  });

  it('pairs create-then-delete (order-independent, D149)', async () => {
    await pairing.created('/r/new');
    await pairing.deleted('/r/old');
    expect(w.calls.filter((c) => c.startsWith('move'))).toHaveLength(2);
    expect(pairing.held).toEqual({ deletes: 0, creates: 0 });
  });

  it('pairs at 90% and handles the unmatched on both sides', async () => {
    for (let i = 0; i < 8; i++) w.file(`/r/old/f${String(i)}.md`, 1);
    // 10 files under old: a, sub/b, f0..f7. 9 reappear (f7 missing); one new file.
    const onDisk: Record<string, number> = {
      '/r/new/a.md': 1,
      '/r/new/sub/b.md': 2,
      '/r/new/extra.md': 5,
    };
    for (let i = 0; i < 7; i++) onDisk[`/r/new/f${String(i)}.md`] = 1;
    w.onDisk('/r/new', onDisk);
    await pairing.deleted('/r/old');
    await pairing.created('/r/new');
    expect(w.calls.filter((c) => c.startsWith('move'))).toHaveLength(9);
    expect(w.calls).toContain('unlink /r/old/f7.md');
    expect(w.calls).toContain('stability /r/new/extra.md');
  });

  it('a size mismatch is no match; below 90% stays unpaired until bufferMs', async () => {
    w.onDisk('/r/new', { '/r/new/a.md': 1, '/r/new/sub/b.md': 99 });
    await pairing.deleted('/r/old');
    await pairing.created('/r/new');
    expect(w.calls.some((c) => c.startsWith('move'))).toBe(false);
    expect(pairing.held).toEqual({ deletes: 1, creates: 1 });
    await vi.advanceTimersByTimeAsync(BUFFER_MS);
    await w.drain();
    expect(w.calls).toEqual([
      'drop /r/old',
      'unlink /r/old/a.md',
      'unlink /r/old/sub/b.md',
      'reconcile /r/new',
    ]);
  });

  it('buffers file events under a held create; covered ones settle against the walk (D142)', async () => {
    await pairing.created('/r/new');
    expect(pairing.buffer('/r/new/a.md')).toBe(true);
    expect(pairing.buffer('/r/newer/x.md')).toBe(false);
    expect(pairing.buffer('/r/elsewhere.md')).toBe(false);
    await pairing.deleted('/r/old');
    expect(w.calls.slice(-1)).toEqual(['stability /r/new/a.md']);
    expect(w.calls.indexOf('drop /r/new')).toBeLessThan(
      w.calls.indexOf('stability /r/new/a.md'),
    );
  });

  it('an unpaired create is reconciled only after its hold, then its buffered events', async () => {
    await pairing.created('/r/new');
    pairing.buffer('/r/new/a.md');
    await vi.advanceTimersByTimeAsync(BUFFER_MS - 1);
    await w.drain();
    expect(w.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await w.drain();
    expect(w.calls).toEqual(['reconcile /r/new', 'stability /r/new/a.md']);
    expect(pairing.buffer('/r/new/b.md')).toBe(false);
  });

  it('an unpaired delete unlinks its whole subtree after its hold', async () => {
    await pairing.deleted('/r/old');
    await vi.advanceTimersByTimeAsync(BUFFER_MS);
    await w.drain();
    expect(w.calls).toEqual([
      'drop /r/old',
      'unlink /r/old/a.md',
      'unlink /r/old/sub/b.md',
    ]);
  });

  it('ignores a repeated create of a held directory', async () => {
    await pairing.created('/r/q');
    await pairing.created('/r/q');
    expect(pairing.held).toEqual({ deletes: 0, creates: 1 });
  });

  it('treats a failed pairing walk as an empty directory', async () => {
    w.deps.walk = () => Promise.reject(new Error('EACCES'));
    pairing = new DirectoryPairing(w.deps);
    await pairing.deleted('/r/old');
    await pairing.created('/r/new');
    expect(pairing.held).toEqual({ deletes: 1, creates: 1 });
  });

  it('stop drops holds without resolving them', async () => {
    await pairing.deleted('/r/old');
    await pairing.created('/r/elsewhere');
    pairing.stop();
    await vi.advanceTimersByTimeAsync(BUFFER_MS);
    await w.drain();
    expect(w.calls).toEqual(['drop /r/old']);
    expect(pairing.held).toEqual({ deletes: 0, creates: 0 });
  });
});
