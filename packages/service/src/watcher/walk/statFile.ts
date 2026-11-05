/**
 * @module watcher/walk/statFile
 * `stat` a path as a file (its size and mtime, or undefined when it is gone or not a file), and the stat-confirmed absence reconciliation unlinks on. I/O: one `stat`/`lstat`.
 */

import { lstat, stat } from 'node:fs/promises';

import type { FileStats } from '../inventory/Inventory';
import { walkLimit } from './walkLimiter';

/**
 * Size and mtime of a file.
 *
 * @param path - The path.
 * @returns Its stats, or undefined when absent, unreadable or not a file.
 */
export async function statFile(path: string): Promise<FileStats | undefined> {
  try {
    const stats = await stat(path);
    return stats.isFile()
      ? { size: stats.size, mtimeMs: stats.mtimeMs }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether `path` is confirmed gone: `lstat` fails with `ENOENT` or
 * `ENOTDIR`. Any other failure (permissions, an unreachable share) is not
 * an absence, so it never becomes an unlink (D90). Runs under the walk
 * limiter.
 *
 * @param path - The path.
 * @returns True only when the path is confirmed absent.
 */
export async function isGone(path: string): Promise<boolean> {
  try {
    await walkLimit(() => lstat(path));
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}
