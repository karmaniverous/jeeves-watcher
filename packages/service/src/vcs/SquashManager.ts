/**
 * @module vcs/SquashManager
 * Handles scheduled squash retention for git-backed VCS roots.
 */

import { execFile } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { VcsRetentionConfig } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';

const execFileAsync = promisify(execFile);

/**
 * Parse a standard 5-field cron expression and check if the current time matches.
 * Fields: minute hour dom month dow
 * Supports: numbers, wildcards, lists (1,3,5), ranges (1-5), steps (star/5)
 */
export function cronMatchesNow(
  cronExpr: string,
  now: Date = new Date(),
): boolean {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const minute = now.getMinutes();
  const hour = now.getHours();
  const dom = now.getDate();
  const month = now.getMonth() + 1; // 1-based
  const dow = now.getDay(); // 0=Sunday

  return (
    fieldMatches(fields[0], minute, 0, 59) &&
    fieldMatches(fields[1], hour, 0, 23) &&
    fieldMatches(fields[2], dom, 1, 31) &&
    fieldMatches(fields[3], month, 1, 12) &&
    fieldMatches(fields[4], dow, 0, 7) // 7 also means Sunday
  );
}

function fieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  for (const part of field.split(',')) {
    if (partMatches(part.trim(), value, min, max)) return true;
  }
  return false;
}

function partMatches(
  part: string,
  value: number,
  min: number,
  max: number,
): boolean {
  // Handle step: */N or range/N
  const [rangePart, stepStr] = part.split('/');
  const step = stepStr ? parseInt(stepStr, 10) : 1;

  if (rangePart === '*') {
    return (value - min) % step === 0;
  }

  // Handle range: N-M
  if (rangePart.includes('-')) {
    const [startStr, endStr] = rangePart.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  }

  // Plain number
  const num = parseInt(rangePart, 10);
  if (step === 1) {
    // For dow, treat 7 as 0 (Sunday)
    if (max === 7 && num === 7) return value === 0;
    return value === num;
  }
  // Number with step doesn't make sense for single values, treat as exact
  return value === num;
}

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
  private readonly remoteUrl: string | undefined;
  private readonly accessToken: string | undefined;
  private readonly logger: pino.Logger;
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    rootPath: string,
    retention: VcsRetentionConfig,
    logger: pino.Logger,
    remoteUrl?: string,
    accessToken?: string,
  ) {
    this.rootPath = rootPath;
    this.retention = retention;
    this.logger = logger;
    this.remoteUrl = remoteUrl;
    this.accessToken = accessToken;
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
   */
  async runSquash(): Promise<SquashResult> {
    // Check for index.lock before starting multi-step operation
    const lockPath = join(this.rootPath, '.git', 'index.lock');
    try {
      await access(lockPath);
      // Lock exists — abort and retry next cycle
      this.logger.warn(
        { root: this.rootPath },
        'Squash aborted: index.lock exists, will retry next cycle',
      );
      return { squashed: false, error: 'index.lock exists' };
    } catch {
      // No lock — proceed
    }

    try {
      const commits = await this.getCommitLog();

      if (commits.length <= 1) {
        return { squashed: false };
      }

      const boundaryIndex = this.calculateRetentionBoundary(commits);

      if (boundaryIndex <= 0) {
        // All commits are within retention or only one commit before boundary
        return { squashed: false };
      }

      // Perform the squash
      await this.performSquash(commits, boundaryIndex);

      const commitsRemoved = boundaryIndex;
      const commitsRetained = commits.length - boundaryIndex;

      this.logger.info(
        { root: this.rootPath, commitsRemoved, commitsRetained },
        'Squash retention completed',
      );

      // Force push if remote configured
      await this.forcePushIfConfigured();

      return { squashed: true, commitsRemoved, commitsRetained };
    } catch (error) {
      const message = normalizeError(error).message;
      this.logger.error(
        { root: this.rootPath, err: normalizeError(error) },
        'Squash operation failed',
      );
      return { squashed: false, error: message };
    }
  }

  /**
   * Get all commits in chronological order (oldest first).
   */
  async getCommitLog(): Promise<CommitInfo[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--format=%H %aI', '--reverse'],
        { cwd: this.rootPath },
      );

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
    const now = new Date();
    const maxAgeMs = this.retention.maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(now.getTime() - maxAgeMs);

    // Find the first commit that is within the age window (to keep)
    let ageBoundary = commits.length; // Default: all too old
    for (let i = 0; i < commits.length; i++) {
      if (commits[i].date >= cutoffDate) {
        ageBoundary = i;
        break;
      }
    }

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
   */
  private async performSquash(
    commits: CommitInfo[],
    boundaryIndex: number,
  ): Promise<void> {
    // The commit just before boundary is the last one to squash
    const baselineHash = commits[boundaryIndex - 1].hash;

    // Get the current branch name
    const { stdout: branchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: this.rootPath },
    );
    const currentBranch = branchOut.trim();

    const orphanBranch = `__squash_orphan_${String(Date.now())}`;

    try {
      // 1. Create orphan branch with the tree state at the baseline commit
      await execFileAsync('git', ['checkout', '--orphan', orphanBranch], {
        cwd: this.rootPath,
      });

      // 2. Reset index to the baseline tree (the last squashed commit's tree)
      await execFileAsync('git', ['reset', '--hard', baselineHash], {
        cwd: this.rootPath,
      });

      // 3. Create the baseline commit with the same tree
      // Use commit-tree for a clean orphan commit
      const { stdout: treeOut } = await execFileAsync(
        'git',
        ['rev-parse', `${baselineHash}^{tree}`],
        { cwd: this.rootPath },
      );
      const treeHash = treeOut.trim();

      const { stdout: commitOut } = await execFileAsync(
        'git',
        ['commit-tree', treeHash, '-m', 'historical baseline'],
        { cwd: this.rootPath },
      );
      const baselineCommitHash = commitOut.trim();

      // 4. Reset orphan branch to this new baseline commit
      await execFileAsync('git', ['reset', '--hard', baselineCommitHash], {
        cwd: this.rootPath,
      });

      // 5. Cherry-pick boundary..HEAD (the retained commits)
      // Get the list of commits to cherry-pick (from boundary to the end)
      const commitsToCherry = commits.slice(boundaryIndex).map((c) => c.hash);

      if (commitsToCherry.length > 0) {
        await execFileAsync('git', ['cherry-pick', ...commitsToCherry], {
          cwd: this.rootPath,
        });
      }

      // 6. Force-update the original branch to the orphan
      const { stdout: newHead } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: this.rootPath },
      );

      await execFileAsync(
        'git',
        ['branch', '-f', currentBranch, newHead.trim()],
        { cwd: this.rootPath },
      );

      // 7. Switch back to original branch
      await execFileAsync('git', ['checkout', currentBranch], {
        cwd: this.rootPath,
      });

      // 8. Delete orphan branch
      await execFileAsync('git', ['branch', '-D', orphanBranch], {
        cwd: this.rootPath,
      });
    } catch (error) {
      // Attempt cleanup: try to get back to original branch
      try {
        await execFileAsync('git', ['checkout', '-f', currentBranch], {
          cwd: this.rootPath,
        });
        await execFileAsync('git', ['branch', '-D', orphanBranch], {
          cwd: this.rootPath,
        });
      } catch {
        // Cleanup failed — log but re-throw original error
      }

      // Remove index.lock if left behind
      try {
        const lockFile = join(this.rootPath, '.git', 'index.lock');
        await rm(lockFile, { force: true });
      } catch {
        // ignore
      }

      throw error;
    }
  }

  /**
   * Force push to remote after squash (history rewrite requires force).
   */
  private async forcePushIfConfigured(): Promise<void> {
    if (!this.remoteUrl) return;

    try {
      const pushUrl = this.accessToken
        ? this.remoteUrl.replace(/^https:\/\//, `https://${this.accessToken}@`)
        : this.remoteUrl;

      await execFileAsync('git', ['push', '--force', pushUrl, 'HEAD'], {
        cwd: this.rootPath,
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
