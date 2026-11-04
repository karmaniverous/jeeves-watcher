/**
 * @module watcher/chokidarOptions.test
 * chokidar 6 keeps 0.20.0's behaviour: the backend is pinned (`native` per directory, or `polling`), and the change source still sees adds, changes and unlinks, honours `ignored`, lists watched files and restarts after `stop()` (close is terminal in 6).
 */

import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WatchConfig } from '../config/types';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { backendOptions } from './chokidarOptions';
import { FileSystemWatcher } from './index';

describe('backendOptions', () => {
  it('pins the per-directory native backend unless polling', () => {
    expect(backendOptions()).toEqual({ backend: 'native' });
    expect(backendOptions({ usePolling: false, pollIntervalMs: 50 })).toEqual({
      backend: 'native',
    });
  });

  it('polls at a positive interval, else at chokidar default', () => {
    expect(backendOptions({ usePolling: true, pollIntervalMs: 250 })).toEqual({
      backend: 'polling',
      pollingInterval: 250,
    });
    for (const pollIntervalMs of [undefined, 0, -5]) {
      expect(backendOptions({ usePolling: true, pollIntervalMs })).toEqual({
        backend: 'polling',
      });
    }
  });
});

let dir: string;

const norm = (path: string): string =>
  process.platform === 'win32' ? path.toLowerCase() : path;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'chokidar6-')));
  await mkdir(join(dir, 'skip'));
  await writeFile(join(dir, 'a.md'), 'a');
  await writeFile(join(dir, 'skip', 'b.md'), 'b');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

/** A started watcher over `dir` recording VCS change callbacks. */
async function startWatcher(config: Partial<WatchConfig>) {
  const events: string[] = [];
  let ready!: () => void;
  const scanned = new Promise<void>((resolve) => (ready = resolve));
  const queue = { enqueue: vi.fn(), start: vi.fn() } as unknown as EventQueue;
  const watcher = new FileSystemWatcher(
    {
      paths: [`${dir.replace(/\\/g, '/')}/**/*.md`],
      ignored: ['**/skip/**'],
      ...config,
    },
    queue,
    {} as DocumentProcessorInterface,
    pino({ level: 'silent' }),
    {
      onVcsFileChange: (path, event) => {
        events.push(`${event} ${path.slice(dir.length + 1)}`);
      },
      onInitialScanComplete: () => {
        ready();
      },
    },
  );
  watcher.start();
  await scanned;
  return { watcher, events };
}

describe.each([
  ['native', {}],
  ['polling', { usePolling: true, pollIntervalMs: 50 }],
])('FileSystemWatcher on chokidar 6 (%s)', (_label, config) => {
  it('scans, filters, lists and follows changes, then restarts after stop', async () => {
    const { watcher, events } = await startWatcher(config);

    expect(events).toEqual(['add a.md']);
    // Watch roots are lower-cased on Windows (globToDir), as in 0.20.0.
    const watched = watcher.getWatchedFiles().map(norm);
    expect(watched).toContain(norm(join(dir, 'a.md')));
    expect(watched).not.toContain(norm(join(dir, 'skip', 'b.md')));

    await writeFile(join(dir, 'c.md'), 'c');
    await vi.waitFor(
      () => {
        expect(events).toContain('add c.md');
      },
      {
        timeout: 5000,
      },
    );
    await writeFile(join(dir, 'a.md'), 'a changed');
    await vi.waitFor(
      () => {
        expect(events).toContain('change a.md');
      },
      {
        timeout: 5000,
      },
    );
    await unlink(join(dir, 'c.md'));
    await vi.waitFor(
      () => {
        expect(events).toContain('unlink c.md');
      },
      {
        timeout: 5000,
      },
    );
    await writeFile(join(dir, 'skip', 'b.md'), 'b changed');

    await watcher.stop();
    expect(watcher.getWatchedFiles()).toEqual([]);
    expect(events.some((e) => e.includes('b.md'))).toBe(false);

    // chokidar 6's close() is terminal: start() must build a new watcher.
    events.length = 0;
    const restarted = new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (events.includes('add a.md')) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
    watcher.start();
    await restarted;
    await watcher.stop();
  }, 30_000);
});
