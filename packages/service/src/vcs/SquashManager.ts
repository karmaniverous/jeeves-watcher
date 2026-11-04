/**
 * @module vcs/SquashManager
 * Scheduled squash retention for one VCS root: under RootGitLock, flush the pending batch, then rewrite the branch in plumbing and move it with a compare-and-swap `update-ref` (D101, D148, D166). Force-pushes when a remote is set.
 *
 * No checkout, reset or cherry-pick runs, so the working tree and the index
 * are never touched: a file untracked by `/vcs/exclude` or the size cap
 * keeps its newest content on disk, and no clean tree is needed. Squash
 * still refuses while a merge, rebase, cherry-pick or revert is in
 * progress, or when HEAD is not on the configured branch (D20).
 */

import type { VcsRetentionConfig } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { cronMatchesNow } from './cronMatch';
import { GIT_TIMEOUT_PUSH } from './gitExec';
import { gitPushNonInteractive } from './gitNetwork';
import {
  detectStaleGitOperation,
  headRef,
  STALE_OPERATION_HINT,
} from './gitRepoState';
import type { RootGitLock } from './RootGitLock';
import { runGit } from './runGit';
import {
  type CommitInfo,
  listFirstParent,
  rebuildHistory,
  refTip,
  treeOf,
} from './squashPlumbing';

export type { CommitInfo };

/** Result of a squash operation. */
export interface SquashResult {
  squashed: boolean;
  commitsRemoved?: number;
  commitsRetained?: number;
  error?: string;
}

/** Test hooks around the reference update (not public API). @internal */
export interface SquashHooks {
  /** Receives the rebuilt tip; returns the tip to check and publish. */
  rebuiltTip?: (tip: string) => Promise<string>;
  /** Runs after the tree check, just before `update-ref`. */
  beforeUpdateRef?: () => Promise<void>;
}

/** Options for SquashManager construction beyond the required params. */
export interface SquashManagerOptions {
  /** Git branch name for squash operations. Default: "master". */
  branch?: string;
  /** The root's lock; squash holds it for its whole run (D81). */
  lock: RootGitLock;
  /**
   * Commit pending changes inside the hold through the non-locking commit
   * path (D101). Resolves false when that commit failed (squash refuses).
   */
  flushInHold?: () => Promise<boolean>;
  /** Remote URL for force-push after squash. */
  remoteUrl?: string;
  /** Access token for HTTPS push authentication. */
  accessToken?: string;
  /** Test hooks (not public API). @internal */
  hooks?: SquashHooks;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reflog reason of the squash's reference update (D166). */
export const SQUASH_REFLOG_REASON = 'jeeves-watcher squash';

/**
 * Manages scheduled squash retention for a single VCS root.
 *
 * Runs on a cron schedule (checked every 60s). When triggered, squashes
 * commits older than the retention boundary (the tighter of maxAgeDays
 * and maxVersions) into a single "historical baseline" commit and
 * recreates the retained commits on top of it.
 */
export class SquashManager {
  private readonly branch: string;
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly rootPath: string,
    private readonly retention: VcsRetentionConfig,
    private readonly logger: pino.Logger,
    private readonly options: SquashManagerOptions,
  ) {
    this.branch = options.branch ?? 'master';
  }

  /**
   * Start the cron-based squash scheduler.
   * Checks every 60 seconds if the cron expression matches.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.intervalTimer = setInterval(() => {
      if (cronMatchesNow(this.retention.squashCron)) {
        void this.runSquash();
      }
    }, 60_000);

    this.logger.info(
      { root: this.rootPath, cron: this.retention.squashCron },
      'SquashManager started',
    );
  }

  /**
   * Stop the cron scheduler.
   */
  stop(): void {
    this.running = false;
    if (this.intervalTimer !== undefined) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    this.logger.info({ root: this.rootPath }, 'SquashManager stopped');
  }

  /**
   * Run the squash under the root's lock: flush, guard, rewrite, publish,
   * force-push. Exposed publicly for testing.
   */
  async runSquash(): Promise<SquashResult> {
    return this.options.lock.run('squash', async () => {
      try {
        if (this.options.flushInHold && !(await this.options.flushInHold())) {
          const error = 'Squash refused: the pending batch failed to commit';
          this.logger.warn({ root: this.rootPath }, error);
          return { squashed: false, error };
        }
        const blocked = await this.checkRepoPreconditions();
        if (blocked !== undefined) return { squashed: false, error: blocked };
        return await this.squashBranch();
      } catch (error) {
        this.logger.error(
          { root: this.rootPath, err: normalizeError(error) },
          'Squash operation failed',
        );
        return { squashed: false, error: normalizeError(error).message };
      }
    });
  }

  /**
   * Refuse while an abandoned cherry-pick, rebase or merge is present, or
   * when HEAD is not on the configured branch (#249, D20: report only).
   *
   * @returns The refusal reason, or undefined if the squash may proceed.
   */
  private async checkRepoPreconditions(): Promise<string | undefined> {
    const marker = await detectStaleGitOperation(this.rootPath);
    if (marker !== undefined) {
      const error = `Squash refused: in-progress git operation detected (.git/${marker})`;
      this.logger.error(
        { root: this.rootPath, marker },
        `${error} — ${STALE_OPERATION_HINT}`,
      );
      return error;
    }

    const head = (await headRef(this.rootPath)) ?? '';
    if (head !== `refs/heads/${this.branch}`) {
      const error = `Squash refused: HEAD is not on ${this.branch}`;
      this.logger.warn({ root: this.rootPath, head }, error);
      return error;
    }
    return undefined;
  }

  /** Rewrite and publish the branch (inside the hold). */
  private async squashBranch(): Promise<SquashResult> {
    const ref = `refs/heads/${this.branch}`;
    const old = (await runGit(this.rootPath, ['rev-parse', ref])).stdout.trim();
    const commits = await listFirstParent(this.rootPath, old);
    if (commits.at(-1)?.hash !== old) {
      const error = 'Squash skipped: first-parent list does not end at the tip';
      this.logger.warn({ root: this.rootPath, old }, error);
      return { squashed: false, error };
    }

    const boundaryIndex =
      commits.length <= 1 ? 0 : this.calculateRetentionBoundary(commits);
    if (boundaryIndex <= 0) return { squashed: false };

    const rebuilt = await rebuildHistory(this.rootPath, commits, boundaryIndex);
    const tip = (await this.options.hooks?.rebuiltTip?.(rebuilt)) ?? rebuilt;
    if (
      (await treeOf(this.rootPath, tip)) !== (await treeOf(this.rootPath, old))
    ) {
      const error = 'Squash stopped: rebuilt tree differs from the branch tip';
      this.logger.error({ root: this.rootPath, old, tip }, error);
      return { squashed: false, error };
    }

    await this.options.hooks?.beforeUpdateRef?.();
    try {
      await runGit(this.rootPath, [
        'update-ref',
        '-m',
        SQUASH_REFLOG_REASON,
        ref,
        tip,
        old,
      ]);
    } catch (error) {
      // A failure with the ref unchanged is git's own (lock, timeout).
      if ((await refTip(this.rootPath, ref)) === old) throw error;
      const message = 'Squash skipped: the branch moved during the squash';
      this.logger.warn(
        { root: this.rootPath, err: normalizeError(error) },
        `${message}; retrying at the next schedule`,
      );
      return { squashed: false, error: message };
    }

    const commitsRemoved = boundaryIndex;
    const commitsRetained = commits.length - boundaryIndex;
    this.logger.info(
      { root: this.rootPath, commitsRemoved, commitsRetained },
      'Squash retention completed',
    );
    await this.forcePushIfConfigured();
    return { squashed: true, commitsRemoved, commitsRetained };
  }

  /**
   * Get all first-parent commits of HEAD in chronological order (oldest
   * first), or none when HEAD is unborn.
   */
  async getCommitLog(): Promise<CommitInfo[]> {
    try {
      return await listFirstParent(this.rootPath, 'HEAD');
    } catch {
      return [];
    }
  }

  /**
   * Calculate the retention boundary index.
   * Returns the index of the oldest commit to KEEP.
   * All commits before this index will be squashed into a baseline.
   *
   * Strategy: find the tighter constraint between age and count.
   * - Age: keep commits newer than maxAgeDays
   * - Count: keep the last maxVersions commits
   * The boundary is the one that retains FEWER old commits (tighter).
   */
  calculateRetentionBoundary(commits: CommitInfo[]): number {
    const cutoffDate = new Date(
      Date.now() - this.retention.maxAgeDays * DAY_MS,
    );

    // First commit within the age window (to keep); default: all too old.
    const firstKept = commits.findIndex((c) => c.date >= cutoffDate);
    const ageBoundary = firstKept === -1 ? commits.length : firstKept;

    // Count boundary: keep the last maxVersions commits
    const countBoundary = Math.max(
      0,
      commits.length - this.retention.maxVersions,
    );

    // The tighter constraint wins (keeps fewer old commits = higher boundary index)
    return Math.max(ageBoundary, countBoundary);
  }

  /**
   * Force push to remote after squash (history rewrite requires force).
   */
  private async forcePushIfConfigured(): Promise<void> {
    if (!this.options.remoteUrl) return;

    try {
      await gitPushNonInteractive({
        cwd: this.rootPath,
        remoteUrl: this.options.remoteUrl,
        accessToken: this.options.accessToken,
        force: true,
        timeout: GIT_TIMEOUT_PUSH,
      });

      this.logger.info(
        { root: this.rootPath, remote: this.options.remoteUrl },
        'Squash force push succeeded',
      );
    } catch (error) {
      this.logger.error(
        { root: this.rootPath, err: normalizeError(error) },
        'Squash force push failed',
      );
    }
  }
}
