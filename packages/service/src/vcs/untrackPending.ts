/**
 * @module vcs/untrackPending
 * The `.git/untrack.pending` crash marker (D178): written by the untrack helper before `update-ref`, and finished or discarded at startup and before each batch (under RootGitLock). Reads and writes files under `.git`; runs git.
 *
 * A marker whose commit is in HEAD's history means the process stopped
 * after publishing the commit but before the real-index removal: the
 * removal runs again (idempotent). Otherwise the commit was never
 * published: the marker is discarded with a warning, and its exclude
 * pattern line (if any) leaves `.git/info/exclude`.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type pino from 'pino';
import { z } from 'zod';

import { normalizeError } from '../util/normalizeError';
import { gitForceRemove } from './gitIndex';
import { runGit } from './runGit';

/** Marker contents. */
const untrackMarkerSchema = z.object({
  /** HEAD the untrack commit was built on. */
  oldHead: z.string(),
  /** The untrack commit. */
  newCommit: z.string(),
  /** Exclude pattern that caused the untrack, if any. */
  pattern: z.string().optional(),
  /** Root-relative paths to remove from the real index. */
  paths: z.array(z.string()),
});

/** Marker contents. */
export type UntrackMarker = z.infer<typeof untrackMarkerSchema>;

/**
 * Absolute path of the private index (D164: never relative, so git finds
 * it whatever the working directory).
 *
 * @param root - Repository root.
 * @returns `<root>/.git/untrack.index`, absolute.
 */
export function privateIndexPath(root: string): string {
  return resolve(root, '.git', 'untrack.index');
}

/**
 * Delete the private index and its lock (leftovers included).
 *
 * @param root - Repository root.
 */
export async function removePrivateIndex(root: string): Promise<void> {
  const index = privateIndexPath(root);
  await rm(index, { force: true });
  await rm(`${index}.lock`, { force: true });
}

/**
 * Path of a root's marker.
 *
 * @param root - Repository root.
 * @returns `<root>/.git/untrack.pending`.
 */
export function untrackMarkerPath(root: string): string {
  return join(root, '.git', 'untrack.pending');
}

/**
 * Write a root's marker.
 *
 * @param root - Repository root.
 * @param marker - Contents.
 */
export async function writeUntrackMarker(
  root: string,
  marker: UntrackMarker,
): Promise<void> {
  await writeFile(untrackMarkerPath(root), JSON.stringify(marker), 'utf8');
}

/** Read the marker; undefined when absent. Unparseable markers throw. */
async function readMarker(root: string): Promise<UntrackMarker | undefined> {
  let text: string;
  try {
    text = await readFile(untrackMarkerPath(root), 'utf8');
  } catch {
    return undefined;
  }
  return untrackMarkerSchema.parse(JSON.parse(text));
}

/** Whether `commit` is HEAD or one of its ancestors. */
async function inHeadHistory(root: string, commit: string): Promise<boolean> {
  try {
    await runGit(root, ['merge-base', '--is-ancestor', commit, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/** Remove an exclude pattern's line from `.git/info/exclude`. */
async function removeExcludeLine(root: string, pattern: string): Promise<void> {
  const file = join(root, '.git', 'info', 'exclude');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => line.trim() !== pattern);
  if (kept.length !== lines.length)
    await writeFile(file, kept.join('\n'), 'utf8');
}

/**
 * Finish or discard a leftover marker, and delete a leftover private
 * index. Call under the root's RootGitLock.
 *
 * @param root - Repository root.
 * @param logger - Logger.
 * @returns What happened: `none`, `finished` or `discarded`.
 */
export async function recoverUntrackPending(
  root: string,
  logger: pino.Logger,
): Promise<'none' | 'finished' | 'discarded'> {
  await removePrivateIndex(root);
  let marker: UntrackMarker | undefined;
  try {
    marker = await readMarker(root);
  } catch (error) {
    logger.warn(
      { root, err: normalizeError(error) },
      'Discarding unreadable .git/untrack.pending',
    );
    await rm(untrackMarkerPath(root), { force: true });
    return 'discarded';
  }
  if (marker === undefined) return 'none';

  if (await inHeadHistory(root, marker.newCommit)) {
    await gitForceRemove(root, marker.paths);
    await rm(untrackMarkerPath(root), { force: true });
    logger.info(
      { root, commit: marker.newCommit, count: marker.paths.length },
      'Finished an interrupted untrack (.git/untrack.pending)',
    );
    return 'finished';
  }

  if (marker.pattern !== undefined)
    await removeExcludeLine(root, marker.pattern);
  await rm(untrackMarkerPath(root), { force: true });
  logger.warn(
    { root, commit: marker.newCommit, pattern: marker.pattern },
    'Discarded an untrack that was never committed (.git/untrack.pending)',
  );
  return 'discarded';
}
