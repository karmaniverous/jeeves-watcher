/**
 * @module watcher/walk/statFile
 * `stat` a path as a file: its size and mtime, or undefined when it is gone or not a file. I/O: one `stat`.
 */

import { stat } from 'node:fs/promises';

import type { FileStats } from '../inventory/Inventory';

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
