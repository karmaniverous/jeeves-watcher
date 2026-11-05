/**
 * @module watcher/batch/classifyBatch
 * Classify one parcel batch from the disk (D127, D149, D179): drop ignored paths, `lstat` every path (64 at a time), then a present file, a directory create, a directory delete, a file unlink, an 8.3 short name to reconcile, or nothing. Paths under a directory the batch deletes are covered by it. I/O: `lstat` (injected).
 */

import { basename } from 'node:path';

import { normalizeDocumentKey } from '../../util/documentKey';
import type { RawChangeEvent } from '../changeSource/types';
import { createLimiter } from '../walk/walkLimiter';

/** `lstat`s in flight at once for one batch (D149). */
export const BATCH_LSTAT_CONCURRENCY = 64;

/** What one path of a batch means. */
export type ClassifiedPath =
  /** A file on disk: its stability wait starts (or is joined). */
  | { kind: 'file'; path: string }
  /** A directory create (D179): pairing or a reconcile of it. */
  | { kind: 'dirCreate'; path: string }
  /** A directory the inventory held, now gone (D127). */
  | { kind: 'dirDelete'; path: string }
  /** A file the inventory held, now gone. */
  | { kind: 'unlink'; path: string }
  /** An unknown 8.3 short name on Windows: reconcile its parent (D127). */
  | { kind: 'shortName'; path: string };

/** A classified batch: the paths, or the whole batch dropped (root gone). */
export type ClassifiedBatch =
  | { rootGone: false; paths: ClassifiedPath[] }
  | { rootGone: true };

/**
 * What a path's `lstat` found: `absent` only for `ENOENT`/`ENOTDIR`;
 * `other` for anything else (a symlink, a device, an unreadable path),
 * which is never an absence (D90) and is dropped.
 */
export type PathState = 'file' | 'dir' | 'absent' | 'other';

/** What classification reads. */
export interface ClassifyContext {
  /** The batch's root. */
  root: string;
  platform: NodeJS.Platform;
  /** `watch.ignored` and the root's `.git` (D152). */
  ignored: (path: string) => boolean;
  /** The inventory holds files under this directory. */
  isDirectory: (path: string) => boolean;
  /** The inventory holds this file. */
  inInventory: (path: string) => boolean;
  /** `lstat` a path. */
  lstat: (path: string) => Promise<PathState>;
}

/** An 8.3 short name: up to six characters, `~`, digits, short extension. */
const SHORT_NAME = /^[^~.\s]{1,6}~\d{1,6}(\.[^.\s]{1,3})?$/;

/**
 * Whether a basename has the 8.3 short-name shape (`PROGRA~1`).
 *
 * @param name - A basename.
 * @returns True for the shape.
 */
export function isShortName(name: string): boolean {
  return SHORT_NAME.test(name);
}

/**
 * Every proper ancestor key of the given keys (O(keys x depth), never
 * keys x keys: a 20K-path batch stays cheap, D149).
 */
function ancestorsOf(keys: readonly string[]): Set<string> {
  const ancestors = new Set<string>();
  for (const key of keys) {
    for (let at = key.lastIndexOf('/'); at > 0; at = key.lastIndexOf('/', at - 1)) {
      const parent = key.slice(0, at);
      if (ancestors.has(parent)) break;
      ancestors.add(parent);
    }
  }
  return ancestors;
}

/** Whether a proper ancestor of `key` is in `dirs`. */
function hasAncestorIn(key: string, dirs: ReadonlySet<string>): boolean {
  if (dirs.size === 0) return false;
  for (let at = key.lastIndexOf('/'); at > 0; at = key.lastIndexOf('/', at - 1)) {
    if (dirs.has(key.slice(0, at))) return true;
  }
  return false;
}

/** One path of a batch, merged across its events. */
interface BatchPath {
  path: string;
  key: string;
  created: boolean;
}

/** Merge events by path; a `create` among them marks the path created. */
function mergeByPath(events: readonly RawChangeEvent[]): BatchPath[] {
  const byKey = new Map<string, BatchPath>();
  for (const event of events) {
    const key = normalizeDocumentKey(event.path);
    const existing = byKey.get(key);
    if (existing) existing.created ||= event.type === 'create';
    else byKey.set(key, { path: event.path, key, created: event.type === 'create' });
  }
  return [...byKey.values()];
}

/**
 * Classify a batch.
 *
 * @param events - The batch, as parcel delivered it.
 * @param context - Root, filters, inventory lookups and `lstat`.
 * @returns The classified paths, or `rootGone` when the root itself is absent.
 */
export async function classifyBatch(
  events: readonly RawChangeEvent[],
  context: ClassifyContext,
): Promise<ClassifiedBatch> {
  const rootKey = normalizeDocumentKey(context.root);
  const paths = mergeByPath(events).filter(
    (entry) => entry.key === rootKey || !context.ignored(entry.path),
  );
  const limit = createLimiter(BATCH_LSTAT_CONCURRENCY);
  const states = await Promise.all(
    paths.map((entry) => limit(() => context.lstat(entry.path))),
  );
  const underDeletes = ancestorsOf(
    events
      .filter((event) => event.type === 'delete')
      .map((event) => normalizeDocumentKey(event.path)),
  );
  const classified: (ClassifiedPath & { key: string })[] = [];
  for (const [index, entry] of paths.entries()) {
    const state = states[index];
    if (entry.key === rootKey) {
      if (state === 'absent') return { rootGone: true };
      continue;
    }
    const kind = classifyPath(entry, state, underDeletes, context);
    if (kind) classified.push({ kind, path: entry.path, key: entry.key });
  }
  const deletedDirs = new Set(
    classified
      .filter((entry) => entry.kind === 'dirDelete')
      .map((entry) => entry.key),
  );
  const covered = (key: string) => hasAncestorIn(key, deletedDirs);
  return {
    rootGone: false,
    paths: classified
      .filter((entry) => !covered(entry.key))
      .map(({ kind, path }) => ({ kind, path }) as ClassifiedPath),
  };
}

/** One path's kind, or undefined to drop it. */
function classifyPath(
  entry: BatchPath,
  state: PathState | undefined,
  underDeletes: ReadonlySet<string>,
  context: ClassifyContext,
): ClassifiedPath['kind'] | undefined {
  if (state === 'file') return 'file';
  if (state === 'other') return undefined;
  if (state === 'dir') {
    // A create, or a directory deleted and re-created within the batch
    // (D179); any other directory event (attributes, a renamed child) is
    // dropped: `chmod -R` must not reconcile the tree.
    return entry.created || underDeletes.has(entry.key)
      ? 'dirCreate'
      : undefined;
  }
  if (context.isDirectory(entry.path)) return 'dirDelete';
  if (context.inInventory(entry.path)) return 'unlink';
  if (context.platform === 'win32' && isShortName(basename(entry.path))) {
    return 'shortName';
  }
  return undefined;
}
