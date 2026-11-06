/**
 * @module watcher/FileSystemWatcher.slowCopy.heavy.test
 * A 1,000-file directory copied into a watched root with slow writes (D128): each file is written in several parts, the whole write lasting longer than `stabilityThresholdMs` with each pause shorter than it. Under the real `@parcel/watcher` and under chokidar, every file is enqueued once, as a create, and its job reads its final content. In the serial `heavy` vitest project. Writes temp files.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import type { DocumentProcessorInterface } from '../processor';
import {
  eventsOf as of,
  startWatcherHarness,
  waitFor,
  type WatcherHarness,
} from '../test/watcherHarness';

/** Files in the copied directory (spec: 1,000). */
const FILES = 1000;
/** Parts each file is written in. */
const PARTS = 7;
/** Pause between two parts (well under the stability window). */
const PAUSE_MS = 100;
/** Stability window: shorter than a whole file's write, longer than a pause. */
const STABILITY_MS = 500;
/**
 * Files written at once: few enough that queued file-system calls on a busy
 * runner do not stretch a pause past the stability window (100 did on
 * Windows under chokidar, whose own write wait then emitted a change).
 */
const CONCURRENCY = 50;

/** The final content of file `i`. */
const finalContent = (i: number) =>
  Array.from(
    { length: PARTS },
    (_, p) => `part ${String(p)} of ${String(i)}\n`,
  ).join('');

/**
 * Copy `FILES` files into `<root>/copied`, each written in `PARTS` parts
 * `PAUSE_MS` apart, `CONCURRENCY` files at a time.
 *
 * @returns The longest time between two consecutive parts of one file
 * landing, so a test can tell an overloaded runner from a watcher fault.
 */
async function slowCopy(root: string): Promise<number> {
  let longestGap = 0;
  const dir = join(root, 'copied');
  await mkdir(dir);
  for (let start = 0; start < FILES; start += CONCURRENCY) {
    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, FILES - start) },
        async (_, k) => {
          const i = start + k;
          const file = join(dir, `f${String(i)}.md`);
          await writeFile(file, `part 0 of ${String(i)}\n`);
          let landed = Date.now();
          for (let p = 1; p < PARTS; p++) {
            await sleep(PAUSE_MS);
            await appendFile(file, `part ${String(p)} of ${String(i)}\n`);
            const now = Date.now();
            longestGap = Math.max(longestGap, now - landed);
            landed = now;
          }
        },
      ),
    );
  }
  return longestGap;
}

describe.each(['parcel', 'chokidar'] as const)(
  'FileSystemWatcher (%s), a slow 1,000-file copy (D128)',
  (changeSource) => {
    let harness: WatcherHarness | undefined;

    afterEach(async () => {
      await harness?.close();
      harness = undefined;
    });

    it('enqueues each file once, as a create, and its job reads the final content', async () => {
      expect(PAUSE_MS).toBeLessThan(STABILITY_MS);
      expect(PAUSE_MS * (PARTS - 1)).toBeGreaterThan(STABILITY_MS);
      const processed = new Map<string, string>();
      const processor = {
        processFile: async (path: string) => {
          // Keyed by file name (unique here): the job's path may spell the
          // temp root differently from the harness (a Windows short name).
          processed.set(basename(path), await readFile(path, 'utf8'));
        },
      } as unknown as DocumentProcessorInterface;
      harness = await startWatcherHarness({
        watch: () => ({ changeSource, stabilityThresholdMs: STABILITY_MS }),
        processor,
      });
      const h = harness;
      const longestGap = await slowCopy(h.root);
      // Otherwise the runner, not the watcher, broke the test's premise.
      expect(longestGap).toBeLessThan(STABILITY_MS);
      await waitFor(() => of(h, 'create').length >= FILES, 60_000);
      // Anything late (a second create or a modify) would land meanwhile.
      await sleep(STABILITY_MS * 3);

      const creates = of(h, 'create');
      expect(creates).toHaveLength(FILES);
      expect(new Set(creates).size).toBe(FILES);
      expect(of(h, 'modify')).toEqual([]);
      expect(of(h, 'delete')).toEqual([]);

      for (const job of h.jobs) await job();
      expect(processed.size).toBe(FILES);
      for (let i = 0; i < FILES; i++) {
        expect(processed.get(`f${String(i)}.md`)).toBe(finalContent(i));
      }
    }, 120_000);
  },
);
