/**
 * @module watcher/FileSystemWatcher.lifecycle.test
 * `FileSystemWatcher` outside a run: every sink call, getter and control before start and after stop is a no-op, and readiness without a scan tracker.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { FileSystemWatcher } from '.';

/** A watcher that is never started, with a spying queue. */
function idleWatcher() {
  const enqueue = vi.fn();
  const watcher = new FileSystemWatcher(
    { paths: ['/nowhere/**'], ignored: [] },
    { enqueue, start: vi.fn() } as unknown as EventQueue,
    {} as DocumentProcessorInterface,
    pino({ level: 'silent' }),
  );
  return { watcher, enqueue };
}

describe('FileSystemWatcher outside a run', () => {
  it('ignores sink calls before start', () => {
    const { watcher, enqueue } = idleWatcher();
    watcher.event('add', '/nowhere/a.md');
    watcher.event('addDir', '/nowhere/d');
    watcher.initialScanDone('/nowhere');
    watcher.resubscribed('/nowhere');
    watcher.rootUnavailable('/nowhere', 'ENOENT');
    watcher.rootAvailable('/nowhere');
    watcher.refreshReconcileSchedule();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('has no files or inventory, and stop is a no-op', async () => {
    const { watcher } = idleWatcher();
    expect(watcher.getWatchedFiles()).toEqual([]);
    expect(watcher.inventory).toBeUndefined();
    await expect(watcher.stop()).resolves.toBeUndefined();
  });

  it('is ready without an initial scan tracker', () => {
    expect(idleWatcher().watcher.isReady).toBe(true);
  });
});
