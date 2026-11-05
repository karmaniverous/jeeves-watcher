/**
 * @module watcher/batch/ParcelPipeline.test
 * The parcel batch pipeline with a fake disk (D127, D149, D179): batches held during a root's walk are classified against the full inventory, each kind goes to its handler, pairing runs only with move detection. The 20K/120K scale test: ParcelPipeline.heavy.test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ev, ROOT, setup } from '../../test/parcelPipelineHarness';
import { normalizeDocumentKey } from '../../util/documentKey';
import { lstatState } from './ParcelPipeline';

describe('ParcelPipeline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds a root's batches during its walk, then classifies them against the full inventory", async () => {
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
      new Map([
        [
          normalizeDocumentKey('/r/new/a.md'),
          { path: '/r/new/a.md', size: 1, mtimeMs: 2 },
        ],
      ]),
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
    const { pipeline, calls, inventory } = setup({ [ROOT]: 'absent' });
    inventory.set('/r/a.md', { size: 1, mtimeMs: 1 });
    pipeline.push(ROOT, [ev('delete', ROOT), ev('delete', '/r/a.md')]);
    await pipeline.fifo.idle();
    expect(calls).toEqual([]);
    pipeline.stop();
    pipeline.push(ROOT, [ev('delete', '/r/a.md')]);
    await pipeline.fifo.idle();
    expect(calls).toEqual([]);
  });
});

describe('lstatState', () => {
  it('reads files, directories and absence', async () => {
    await expect(lstatState(import.meta.filename)).resolves.toBe('file');
    await expect(lstatState(import.meta.dirname)).resolves.toBe('dir');
    await expect(lstatState(`${import.meta.dirname}/nope`)).resolves.toBe(
      'absent',
    );
    await expect(
      lstatState(`${import.meta.filename}/under-a-file`),
    ).resolves.toBe('absent');
  });
});
