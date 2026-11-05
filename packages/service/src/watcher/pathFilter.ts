/**
 * @module watcher/pathFilter
 * `FileSystemWatcher`'s own event filters: the watch globs and gitignore (with the `.gitignore` change hook). Pure apart from the gitignore filter's file reads.
 */

import type pino from 'pino';

import type { GitignoreFilter } from '../gitignore';

/**
 * The filters every event passes before it reaches the inventory or the
 * queue (`watch.ignored` prunes earlier, in the source and the walk).
 */
export class WatchFilter {
  /**
   * @param globMatches - Whether a path matches the watch globs.
   * @param logger - Logger.
   * @param gitignoreFilter - Gitignore filter, when `respectGitignore` is on.
   */
  constructor(
    readonly globMatches: (path: string) => boolean,
    private readonly logger: pino.Logger,
    private readonly gitignoreFilter?: GitignoreFilter,
  ) {}

  /** Whether `path` is gitignored (and so skipped). */
  isGitignored(path: string): boolean {
    if (!this.gitignoreFilter) return false;
    const ignored = this.gitignoreFilter.isIgnored(path);
    if (ignored) {
      this.logger.debug({ path }, 'Skipping gitignored file');
    }
    return ignored;
  }

  /**
   * If `path` is a `.gitignore`, re-parse it.
   *
   * @returns True when the gitignore filter was refreshed.
   */
  noteGitignoreChange(path: string): boolean {
    if (!this.gitignoreFilter || !path.endsWith('.gitignore')) return false;
    this.logger.info({ path }, 'Gitignore file changed, refreshing filter');
    this.gitignoreFilter.invalidate(path);
    return true;
  }
}
