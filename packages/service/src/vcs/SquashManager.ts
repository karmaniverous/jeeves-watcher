/**
 * @module vcs/SquashManager
 * Handles scheduled squash retention for git-backed VCS roots.
 */

import type { VcsRetentionConfig } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { cronMatchesNow } from './cronMatch';
import { GIT_TIMEOUT_CHERRY_PICK, GIT_TIMEOUT_PUSH } from './gitExec';
import { gitPushNonInteractive } from './gitNetwork';
import {
  detectStaleGitOperation,
  hasDirtyTrackedFiles,
  indexLockExists,
  removeIndexLock,
  STALE_OPERATION_HINT,
} from './gitRepoState';
import { runGit } from './runGit';

/** Result of a squash operation. */
export interface SquashResult {
  squashed: boolean;
  commitsRemoved?: number;
  commitsRetained?: number;
  error?: string;
}

/** Commit metadata for retention calculation. */
export interface CommitInfo {
  hash: string;
  date: Date;
}

/** Options for SquashManager construction beyond the required params. */
export interface SquashManagerOptions {
  /** Git branch name for squash operations. Default: "master". */
  branch?: string;
  /** Called before squash to drain and pause the commit pipeline. */
  pauseCommits?: () => Promise<void>;
  /** Called after squash to resume the commit pipeline. */
  resumeCommits?: () => void;
  /** Remote URL for force-push after squash. */
  remoteUrl?: string;
  /** Access token for HTTPS push authentication. */
  accessToken?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Manages scheduled squash retention for a single VCS root.
 *
 * Runs on a cron schedule (checked every 60s). When triggered, squashes
 * commits older than the retention boundary (the tighter of maxAgeDays
 * and maxVersions) into a single "historical baseline" orphan commit,
 * then cherry-picks retained commits on top. Force-pushes to remote
 * if configured (D13).
 */
export class SquashManager {
  private readonly rootPath: string;
  private readonly retention: VcsRetentionConfig;
  private readonly branch: string;
  private readonly pauseCommits: (() => Promise<void>) | undefined;
  private readonly resumeCommits: (() => void) | undefined;
  private readonly remoteUrl: string | undefined;
  private readonly accessToken: string | undefined;
  private readonly logger: pino.Logger;
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    rootPath: string,
    retention: VcsRetentionConfig,
    logger: pino.Logger,
    options: SquashManagerOptions = {},
  ) {
    this.rootPath = rootPath;
    this.retention = retention;
    this.logger = logger;
    this.branch = options.branch ?? 'master';
    this.pauseCommits = options.pauseCommits;
    this.resumeCommits = options.resumeCommits;
    this.remoteUrl = options.remoteUrl;
    this.accessToken = options.accessToken;
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
   * Run the squash operation. Exposed publicly for testing.
   *
   * Coordinates with VcsManager by calling pause/resume callbacks
   * to drain and suspend the commit pipeline during the squash.
   */
  async runSquash(): Promise<SquashResult> {
    const blocked = await this.checkRepoPreconditions();
    if (blocked !== undefined) return { squashed: false, error: blocked };

    // Bug 3: Pause the commit pipeline before squash
    try {
      await this.pauseCommits?.();
    } catch (error) {
      this.logger.error(
        { root: this.rootPath, err: normalizeError(error) },
        'Failed to pause commit pipeline before squash',
      );
      // Resume in case pause partially executed (flush succeeded but flag not set)
      this.resumeCommits?.();
      return { squashed: false, error: normalizeError(error).message };
    }

    try {
      // #249 guard: the squash uses `reset --hard` / `checkout -f`, which
      // would destroy uncommitted changes to tracked files. After draining
      // the commit pipeline the tracked tree should be clean; if it isn't,
      // refuse rather than lose content. Untracked files don't block.
      if (await hasDirtyTrackedFiles(this.rootPath)) {
        const error =
          'Squash refused: working tree has uncommitted changes to tracked files';
        this.logger.warn({ root: this.rootPath }, error);
        return { squashed: false, error };
      }

      const commits = await this.getCommitLog();
      const boundaryIndex =
        commits.length <= 1 ? 0 : this.calculateRetentionBoundary(commits);
      if (boundaryIndex <= 0) return { squashed: false };

      await this.performSquash(commits, boundaryIndex);

      const commitsRemoved = boundaryIndex;
      const commitsRetained = commits.length - boundaryIndex;
      this.logger.info(
        { root: this.rootPath, commitsRemoved, commitsRetained },
        'Squash retention completed',
      );

      await this.forcePushIfConfigured();

      return { squashed: true, commitsRemoved, commitsRetained };
    } catch (error) {
      this.logger.error(
        { root: this.rootPath, err: normalizeError(error) },
        'Squash operation failed',
      );
      return { squashed: false, error: normalizeError(error).message };
    } finally {
      // Bug 3: Always resume the commit pipeline
      this.resumeCommits?.();
    }
  }

  /**
   * Refuse to start a multi-step history rewrite while another git
   * operation holds the index or an abandoned cherry-pick, rebase, or merge
   * is present (#249: report only, never auto-clear).
   *
   * @returns The refusal reason, or undefined if the squash may proceed.
   */
  private async checkRepoPreconditions(): Promise<string | undefined> {
    if (await indexLockExists(this.rootPath)) {
      this.logger.warn(
        { root: this.rootPath },
        'Squash aborted: index.lock exists, will retry next cycle',
      );
      return 'index.lock exists';
    }

    const marker = await detectStaleGitOperation(this.rootPath);
    if (marker !== undefined) {
      const error = `Squash refused: in-progress git operation detected (.git/${marker})`;
      this.logger.error(
        { root: this.rootPath, marker },
        `${error} — ${STALE_OPERATION_HINT}`,
      );
      return error;
    }

    return undefined;
  }

  /**
   * Get all commits in chronological order (oldest first).
   */
  async getCommitLog(): Promise<CommitInfo[]> {
    try {
      const { stdout } = await runGit(this.rootPath, [
        'log',
        '--format=%H %aI',
        '--reverse',
      ]);

      if (!stdout.trim()) return [];

      return stdout
        .trim()
        .split('\n')
        .map((line) => {
          const spaceIdx = line.indexOf(' ');
          return {
            hash: line.slice(0, spaceIdx),
            date: new Date(line.slice(spaceIdx + 1)),
          };
        });
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
   * Perform the squash: create orphan with baseline + cherry-pick retained commits.
   * Uses the configured branch name instead of dynamic detection (Bug 1).
   */
  private async performSquash(
    commits: CommitInfo[],
    boundaryIndex: number,
  ): Promise<void> {
    const git = (...args: string[]) => runGit(this.rootPath, args);

    // The commit just before boundary is the last one to squash
    const baselineHash = commits[boundaryIndex - 1].hash;
    const targetBranch = this.branch;
    const orphanBranch = `__squash_orphan_${String(Date.now())}`;

    try {
      // 1-2. Orphan branch at the baseline commit's tree
      await git('checkout', '--orphan', orphanBranch);
      await git('reset', '--hard', baselineHash);

      // 3-4. Single parentless baseline commit with that tree
      const { stdout: treeOut } = await git(
        'rev-parse',
        `${baselineHash}^{tree}`,
      );
      const { stdout: commitOut } = await git(
        'commit-tree',
        treeOut.trim(),
        '-m',
        'historical baseline',
      );
      await git('reset', '--hard', commitOut.trim());

      // 5. Cherry-pick the retained commits on top
      const commitsToCherry = commits.slice(boundaryIndex).map((c) => c.hash);
      if (commitsToCherry.length > 0) {
        await runGit(this.rootPath, ['cherry-pick', ...commitsToCherry], {
          timeoutMs: GIT_TIMEOUT_CHERRY_PICK,
        });
      }

      // 6-8. Move the configured branch to the new history and clean up
      const { stdout: newHead } = await git('rev-parse', 'HEAD');
      await git('branch', '-f', targetBranch, newHead.trim());
      await git('checkout', targetBranch);
      await git('branch', '-D', orphanBranch);
    } catch (error) {
      await this.cleanupFailedSquash(targetBranch, orphanBranch);
      throw error;
    }
  }

  /**
   * Best-effort cleanup after a failed squash. Aborts any half-finished
   * cherry-pick first, so a failure never leaves a sequencer behind (#249),
   * then returns to the configured branch and removes a leftover lock.
   */
  private async cleanupFailedSquash(
    targetBranch: string,
    orphanBranch: string,
  ): Promise<void> {
    const attempt = async (...args: string[]): Promise<void> => {
      try {
        await runGit(this.rootPath, args);
      } catch {
        // Best effort: the state may not need this step.
      }
    };

    await attempt('cherry-pick', '--abort');
    await attempt('checkout', '-f', targetBranch);
    await attempt('branch', '-D', orphanBranch);
    try {
      await removeIndexLock(this.rootPath);
    } catch {
      // Best effort: the original squash error is what gets reported.
    }
  }

  /**
   * Force push to remote after squash (history rewrite requires force).
   */
  private async forcePushIfConfigured(): Promise<void> {
    if (!this.remoteUrl) return;

    try {
      await gitPushNonInteractive({
        cwd: this.rootPath,
        remoteUrl: this.remoteUrl,
        accessToken: this.accessToken,
        force: true,
        timeout: GIT_TIMEOUT_PUSH,
      });

      this.logger.info(
        { root: this.rootPath, remote: this.remoteUrl },
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
