/**
 * @module test/watcherHarness
 * Real-filesystem harness for `FileSystemWatcher` tests: a temp watch root, a recording queue (no processing), a stub processor and a `waitFor` poller. Writes temp files; real chokidar.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import pino from 'pino';

import { InitialScanTracker } from '../api/InitialScanTracker';
import type { WatchConfig } from '../config/types';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue, WatchEvent } from '../queue';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { FileSystemWatcher, type FileSystemWatcherOptions } from '../watcher';

/** A started watcher harness. */
export interface WatcherHarness {
  /** The watcher under test. */
  watcher: FileSystemWatcher;
  /** Temp watch root (real path, OS separators). */
  root: string;
  /** Every enqueued event, in order. */
  events: WatchEvent[];
  /** The job of each enqueued event (never run by the queue), in order. */
  jobs: (() => Promise<void>)[];
  /** Enqueued events as `type:relative/path` strings. */
  seen: () => string[];
  /** VCS hook calls as `event:relative/path`. */
  vcs: string[];
  /** The initial scan tracker the watcher reports to. */
  tracker: InitialScanTracker;
  /** Write a file (parents created) under the root. */
  write: (relative: string, content?: string) => Promise<string>;
  /** Stop the watcher and remove the root. */
  close: () => Promise<void>;
}

/** Options for {@link startWatcherHarness}. */
export interface WatcherHarnessOptions {
  /** Files to create before the watcher starts (content by relative path). */
  files?: Record<string, string>;
  /** Runs on the root after `files` are written, before the watcher starts. */
  before?: (root: string) => void | Promise<void>;
  /** Watch config overrides; `paths` defaults to `<root>/**`. */
  watch?: (root: string) => Partial<WatchConfig>;
  /** Extra watcher options. */
  options?: (root: string) => FileSystemWatcherOptions;
  /** Processor the queued jobs call (default: an empty stub). */
  processor?: DocumentProcessorInterface;
  /** Wait for the initial scan to finish (default true). */
  awaitReady?: boolean;
}

/**
 * Poll until `condition` holds.
 *
 * @param condition - The condition.
 * @param timeoutMs - Give up after this long (default 10 s).
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A queue that records what is enqueued and never runs it. */
function recordingQueue(
  events: WatchEvent[],
  jobs: (() => Promise<void>)[],
): EventQueue {
  return {
    enqueue: (event: WatchEvent, job: () => Promise<void>) => {
      events.push(event);
      jobs.push(job);
    },
    start: () => undefined,
  } as unknown as EventQueue;
}

/**
 * Start a `FileSystemWatcher` on a fresh temp root.
 *
 * @param options - Initial files and config overrides.
 * @returns The harness; call `close` after the test.
 */
export async function startWatcherHarness(
  options: WatcherHarnessOptions = {},
): Promise<WatcherHarness> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'jeeves-watcher-fsw-')),
  );
  const write = async (relative: string, content = 'x') => {
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return path;
  };
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    await write(relative, content);
  }
  await options.before?.(root);
  const events: WatchEvent[] = [];
  const jobs: (() => Promise<void>)[] = [];
  const vcs: string[] = [];
  const rel = (path: string) =>
    normalizeSlashes(path).slice(normalizeSlashes(root).length + 1);
  const tracker = new InitialScanTracker();
  const watcher = new FileSystemWatcher(
    {
      paths: [`${normalizeSlashes(root)}/**`],
      ignored: [],
      stabilityThresholdMs: 50,
      // The chokidar suites; parcel suites set `changeSource: 'parcel'`.
      changeSource: 'chokidar',
      ...options.watch?.(root),
    },
    recordingQueue(events, jobs),
    options.processor ?? ({} as DocumentProcessorInterface),
    pino({ level: 'silent' }),
    {
      initialScanTracker: tracker,
      onVcsFileChange: (path, event) => vcs.push(`${event}:${rel(path)}`),
      ...options.options?.(root),
    },
  );
  await watcher.start();
  if (options.awaitReady ?? true) await waitFor(() => watcher.isReady);
  return {
    watcher,
    root,
    events,
    jobs,
    seen: () => events.map((e) => `${e.type}:${rel(e.path)}`),
    vcs,
    tracker,
    write,
    close: async () => {
      await watcher.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}
