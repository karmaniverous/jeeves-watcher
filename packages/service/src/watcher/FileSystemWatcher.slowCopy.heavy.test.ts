/**
 * @module watcher/FileSystemWatcher.slowCopy.heavy.test
 * A 1,000-file directory copied into a watched root with slow writes (D128): each file is written in several parts, the whole write lasting longer than `stabilityThresholdMs` with each pause shorter than it. Under the real `@parcel/watcher` and under chokidar, every file is enqueued once, as a create, and its job reads its final content. The copier measures, per file, an upper bound on each pause as the watcher could see it; a file whose pause a runner stall stretched past the window is outside D128's premise, so it must only end with its final content (spec D201). In the serial `heavy` vitest project. Writes temp files from a child Node process.
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
/**
 * Most files a runner stall may take out of D128's premise before the run
 * says nothing about the watcher. One stall stretches the pauses of the
 * files being written at that moment (at most `CONCURRENCY`); the stall
 * that failed Windows CI on 2026-11-06 (1,388 ms) was one such.
 */
const MAX_STALLED = FILES / 10;

const execFileAsync = promisify(execFile);

/**
 * The copier, run in a child Node process so the watcher's own file-system
 * calls (chokidar polls a `stat` per pending file) cannot queue its writes
 * behind them on the shared libuv thread pool and stretch a pause past the
 * stability window. Arguments: the directory and a JSON object holding
 * `files`, `parts`, `pauseMs` and `concurrency`. Prints, per file, the
 * longest time between two consecutive parts becoming visible, bounded from
 * above: part p-1 cannot be visible before its write started, nor part p
 * after its write returned.
 */
const COPIER = `
const { appendFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const dir = process.argv[1];
const { files, parts, pauseMs, concurrency } = JSON.parse(process.argv[2]);
const gaps = new Array(files).fill(0);
(async () => {
  for (let start = 0; start < files; start += concurrency) {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, files - start) }, async (_, k) => {
        const i = start + k;
        const file = join(dir, 'f' + i + '.md');
        let started = Date.now();
        await writeFile(file, 'part 0 of ' + i + '\\n');
        for (let p = 1; p < parts; p++) {
          await sleep(pauseMs);
          const next = Date.now();
          await appendFile(file, 'part ' + p + ' of ' + i + '\\n');
          gaps[i] = Math.max(gaps[i], Date.now() - started);
          started = next;
        }
      }),
    );
  }
  process.stdout.write(JSON.stringify(gaps));
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
 * @returns Per file, the upper bound on its longest pause as the watcher
 * could see it, so a test can tell a runner stall from a watcher fault.
 */
async function slowCopy(root: string): Promise<number[]> {
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
  return JSON.parse(stdout) as number[];
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
      /** Every read a job made, per file name. */
      const processed = new Map<string, string[]>();
      const processor = {
        processFile: async (path: string) => {
          // Keyed by file name (unique here): the job's path may spell the
          // temp root differently from the harness (a Windows short name).
          const name = basename(path);
          const content = await readFile(path, 'utf8');
          processed.set(name, [...(processed.get(name) ?? []), content]);
        },
      } as unknown as DocumentProcessorInterface;
      harness = await startWatcherHarness({
        watch: () => ({ changeSource, stabilityThresholdMs: STABILITY_MS }),
        processor,
      });
      const h = harness;
      // Each job runs as soon as it is enqueued, while the copy goes on, so
      // a file emitted before its last part landed is read short.
      let ran = 0;
      const runJobs = async () => {
        while (ran < h.jobs.length) await h.jobs[ran++]();
      };
      const draining = waitFor(async () => {
        await runJobs();
        return ran >= FILES;
      }, 180_000);
      draining.catch(() => undefined);
      const gaps = await slowCopy(h.root);
      // Files a runner stall pushed past the window: the watcher may rightly
      // have seen them settle early. Too many, and the run proves nothing.
      const stalled = new Set(
        gaps.flatMap((gap, i) =>
          gap >= STABILITY_MS ? [`f${String(i)}.md`] : [],
        ),
      );
      expect(stalled.size).toBeLessThanOrEqual(MAX_STALLED);
      await draining;
      // Anything late (a second create or a modify) would land meanwhile.
      await sleep(STABILITY_MS * 3);
      await runJobs();

      const creates = of(h, 'create');
      expect(creates).toHaveLength(FILES);
      expect(new Set(creates).size).toBe(FILES);
      const modified = of(h, 'modify').map((path) => basename(path));
      expect(modified.filter((name) => !stalled.has(name))).toEqual([]);
      expect(of(h, 'delete')).toEqual([]);

      // One read of the final content; a stalled file's last read is final.
      const expected = new Map<string, string[]>();
      const actual = new Map<string, string[]>();
      for (let i = 0; i < FILES; i++) {
        const name = `f${String(i)}.md`;
        const reads = processed.get(name) ?? [];
        expected.set(name, [finalContent(i)]);
        actual.set(name, stalled.has(name) ? reads.slice(-1) : reads);
      }
      expect(processed.size).toBe(FILES);
      expect(actual).toEqual(expected);
    }, 240_000);
  },
);
