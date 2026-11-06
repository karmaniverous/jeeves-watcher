/**
 * @module vcs/OverCapWarnings
 * Once-per-path-per-process warnings for files over `vcs.maxFileBytes` (D80, D168). In-memory only.
 *
 * An entry is cleared when its file is seen under the cap again, so a file
 * that shrinks and then grows past the cap is warned about again.
 */

import type pino from 'pino';

import { normalizePathCase } from './gitExec';

/** Remembers which over-cap paths have been warned about. */
export class OverCapWarnings {
  private readonly warned = new Set<string>();

  /**
   * Warn about an over-cap path unless already warned.
   *
   * @param root - Repository root.
   * @param rel - Root-relative path.
   * @param size - File size in bytes.
   * @param tracked - Whether git tracks it (it is then untracked).
   * @param logger - Logger.
   */
  warn(
    root: string,
    rel: string,
    size: number,
    tracked: boolean,
    logger: pino.Logger,
  ): void {
    const key = normalizePathCase(rel);
    if (this.warned.has(key)) return;
    this.warned.add(key);
    logger.warn(
      { root, path: rel, size },
      tracked
        ? 'Tracked file is over vcs.maxFileBytes: untracking it (its history ends at its last committed version)'
        : 'File exceeds vcs.maxFileBytes: not staged',
    );
  }

  /**
   * Forget a path (its file is under the cap).
   *
   * @param rel - Root-relative path.
   */
  clear(rel: string): void {
    this.warned.delete(normalizePathCase(rel));
  }
}
