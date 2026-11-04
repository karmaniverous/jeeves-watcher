/**
 * @module vcs/tempFiles
 * Git's temporary object files under `.git/objects` (`tmp_pack_*`, `tmp_idx_*`, `tmp_obj_*`, `tmp_objdir-*`): list them, sweep ones untouched for an hour, and delete the ones a killed call left once they stop changing (D66). Reads and deletes files under `.git/objects`.
 *
 * A temporary file is never referenced until git renames it into place, so
 * deleting a stale one loses no repository data. Another process's file
 * that is still being written changes within the stability window and is
 * left alone.
 */

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Names git gives temporary object files and directories. */
const TEMP_NAME = /^(tmp_pack_|tmp_idx_|tmp_obj_|tmp_objdir-)/;

/** Two-hex-digit loose-object directory names. */
const LOOSE_DIR = /^[0-9a-f]{2}$/;

/** Sweep threshold: temp files untouched this long are deleted. */
export const TEMP_SWEEP_AGE_MS = 60 * 60_000;

/** Stability window of the post-kill check. */
export const TEMP_STABLE_MS = 60_000;

/** Names in a directory, or none when it is unreadable or absent. */
async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/**
 * List temporary object files and directories of a repository: in
 * `objects/`, `objects/pack/` and each `objects/??/`.
 *
 * @param root - Repository root.
 * @returns Absolute paths.
 */
export async function listTempFiles(root: string): Promise<string[]> {
  const objects = join(root, '.git', 'objects');
  const top = await names(objects);
  const dirs = [
    objects,
    join(objects, 'pack'),
    ...top.filter((n) => LOOSE_DIR.test(n)).map((n) => join(objects, n)),
  ];
  const found: string[] = [];
  for (const dir of dirs) {
    for (const name of await names(dir)) {
      if (TEMP_NAME.test(name)) found.push(join(dir, name));
    }
  }
  return found;
}

/** Size and mtime of a path, or undefined when it is gone. */
async function fingerprint(path: string): Promise<string | undefined> {
  try {
    const s = await stat(path);
    return `${String(s.size)}:${String(s.mtimeMs)}`;
  } catch {
    return undefined;
  }
}

/**
 * Delete temporary files untouched for more than `ageMs`.
 *
 * @param root - Repository root.
 * @param ageMs - Age threshold (default one hour).
 * @param now - Clock (tests).
 * @returns The deleted paths.
 */
export async function sweepTempFiles(
  root: string,
  ageMs: number = TEMP_SWEEP_AGE_MS,
  now: () => number = Date.now,
): Promise<string[]> {
  const deleted: string[] = [];
  for (const path of await listTempFiles(root)) {
    try {
      if (now() - (await stat(path)).mtimeMs > ageMs) {
        await rm(path, { recursive: true, force: true });
        deleted.push(path);
      }
    } catch {
      // Gone or unreadable: nothing to sweep.
    }
  }
  return deleted;
}

/**
 * After a killed call: delete each temp file absent from `snapshot` once
 * its size and mtime are unchanged across two stats `stableMs` apart. Runs
 * in the background, without RootGitLock, so bisection is not delayed.
 *
 * @param root - Repository root.
 * @param snapshot - Temp files that existed before the call.
 * @param stableMs - Stability window (default 60 s).
 * @returns The deleted paths.
 */
export async function cleanTempFilesAfterKill(
  root: string,
  snapshot: ReadonlySet<string>,
  stableMs: number = TEMP_STABLE_MS,
): Promise<string[]> {
  const created = (await listTempFiles(root)).filter((p) => !snapshot.has(p));
  const first = await Promise.all(created.map(fingerprint));
  await new Promise((resolve) => setTimeout(resolve, stableMs).unref());
  const deleted: string[] = [];
  for (const [i, path] of created.entries()) {
    const before = first[i];
    if (before === undefined || (await fingerprint(path)) !== before) continue;
    await rm(path, { recursive: true, force: true });
    deleted.push(path);
  }
  return deleted;
}
