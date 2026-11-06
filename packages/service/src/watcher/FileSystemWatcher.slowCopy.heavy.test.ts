/**
 * @module watcher/FileSystemWatcher.slowCopy.heavy.test
 * A 1,000-file directory copied into a watched root with slow writes (D128): each file is written in several parts, the whole write lasting longer than `stabilityThresholdMs` with each pause shorter than it. Under the real `@parcel/watcher` and under chokidar, every file is enqueued once, as a create, and its job reads its final content. In the serial `heavy` vitest project. Writes temp files from a child Node process.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

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
 * Files written at once, as a copy tool does (a handful, not hundreds).
 * At 50, chokidar's own write wait emitted early on this Windows host: it
 * polls a `stat` per pending file every 100 ms, and when those queue on the
 * thread pool its first poll can land past the window and emit at once
 * (chokidar 5 compares sizes only from the second poll on).
 */
const CONCURRENCY = 10;

const execFileAsync = promisify(execFile);

/**
 * The copier, run in a child Node process so the watcher's own file-system
 * calls (chokidar polls a `stat` per pending file) cannot queue its writes
 * behind them on the shared libuv thread pool and stretch a pause past the
 * stability window. Arguments: the directory and a JSON object holding
 * `files`, `parts`, `pauseMs` and `concurrency`. Prints the longest gap
 * between two consecutive parts of one file landing.
 */
const COPIER = `
const { appendFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const dir = process.argv[1];
const { files, parts, pauseMs, concurrency } = JSON.parse(process.argv[2]);
let longestGap = 0;
(async () => {
  for (let start = 0; start < files; start += concurrency) {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, files - start) }, async (_, k) => {
        const i = start + k;
        const file = join(dir, 'f' + i + '.md');
        await writeFile(file, 'part 0 of ' + i + '\\n');
        let landed = Date.now();
        for (let p = 1; p < parts; p++) {
          await sleep(pauseMs);
          await appendFile(file, 'part ' + p + ' of ' + i + '\\n');
          const now = Date.now();
          longestGap = Math.max(longestGap, now - landed);
          landed = now;
        }
      }),
    );
  }
  process.stdout.write(String(longestGap));
})();
`;

/** The final content of file `i`. */
const finalContent = (i: number) =>
  Array.from(
    { length: PARTS },
    (_, p) => `part ${String(p)} of ${String(i)}\n`,
  ).join('');

/**
 * Copy `FILES` files into `<root>/copied`, each written in `PARTS` parts
 * `PAUSE_MS` apart, `CONCURRENCY` files at a time, from a child process.
 *
 * @returns The longest time between two consecutive parts of one file
 * landing, so a test can tell an overloaded runner from a watcher fault.
 */
async function slowCopy(root: string): Promise<number> {
  const dir = join(root, 'copied');
  await mkdir(dir);
  const { stdout } = await execFileAsync(process.execPath, [
    '-e',
    COPIER,
    dir,
    JSON.stringify({
      files: FILES,
      parts: PARTS,
      pauseMs: PAUSE_MS,
      concurrency: CONCURRENCY,
    }),
  ]);
  return Number(stdout);
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
    }, 240_000);
  },
);
