/**
 * @module vcs/VcsManager
 * Per-root VCS manager for git-backed content versioning: a throttled batch queue, a circuit breaker, the root's RootGitLock, squash scheduling and startup maintenance. Commits run through {@link BatchCommitter} under the lock.
 */

import {
  VCS_DEFAULTS,
  type VcsConfig,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { BatchCommitter } from './BatchCommitter';
import type { CircuitBreakerSnapshot } from './CommitCircuitBreaker';
import { CommitMessageBuilder } from './CommitMessageBuilder';
import type { CommitMessageGenerator } from './CommitMessageGenerator';
import { CommitQueue } from './CommitQueue';
import { listDeletedTrackedPaths } from './gitIndex';
import { OverCapWarnings } from './OverCapWarnings';
import { RootBreaker } from './RootBreaker';
import { RootGitLock } from './RootGitLock';
import { SquashManager } from './SquashManager';
import type { PendingReversion, PushError } from './types';
import { runStartupMaintenance, sweepOnSchedule } from './vcsMaintenance';

export type { PendingReversion, PushError };

/** Per-root circuit breaker state, exposed via /vcs/status. */
export interface VcsBreakerState extends CircuitBreakerSnapshot {
  /** Files queued or in flight, not yet committed. */
  pendingCount: number;
}

/** Optional VcsManager collaborators. */
export interface VcsManagerOptions {
  /** `vcs.maxFileBytes` in bytes, read at each staging (D67). */
  getMaxFileBytes?: () => number;
  /** Path-list timeout override (tests only). */
  timeoutFor?: (paths: number) => number;
}

/**
 * Per-root VCS manager: batches file changes and commits them under the
 * root's {@link RootGitLock}; failed batches are always retained (#249).
 */
export class VcsManager {
  readonly config: VcsConfig;
  readonly rootPath: string;
  readonly remoteUrl: string | undefined;
  /** Serialises this root's git work (D66, D81). */
  readonly lock: RootGitLock;
  private readonly logger: pino.Logger;
  private readonly committer: BatchCommitter;
  private readonly breaker: RootBreaker;
  private readonly queue: CommitQueue;
  private readonly pendingReversions: PendingReversion[] = [];
  private readonly squashManager: SquashManager | undefined;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;
  private isBaseline = true;

  constructor(
    rootPath: string,
    config: VcsConfig,
    logger: pino.Logger,
    commitMessageGenerator?: CommitMessageGenerator,
    remoteUrl?: string,
    accessToken?: string,
    options: VcsManagerOptions = {},
  ) {
    this.rootPath = rootPath;
    this.config = config;
    this.logger = logger;
    this.remoteUrl = remoteUrl;
    this.lock = new RootGitLock(rootPath, logger);

    this.committer = new BatchCommitter({
      rootPath,
      logger,
      messageBuilder: new CommitMessageBuilder(
        rootPath,
        logger,
        commitMessageGenerator,
      ),
      remoteUrl,
      accessToken,
      staleLockThresholdMs: config.staleLockThresholdMs,
      getMaxFileBytes:
        options.getMaxFileBytes ?? (() => VCS_DEFAULTS.maxFileBytes),
      warnings: new OverCapWarnings(),
      ...(options.timeoutFor ? { timeoutFor: options.timeoutFor } : {}),
    });
    this.queue = new CommitQueue({
      maxBatchSize: config.maxBatchSize,
      throttleMs: config.commitThrottleMs,
      onThrottle: () => void this.flush(),
      lock: this.lock,
      commit: (batch) => this.commitBatch(batch),
    });
    this.breaker = new RootBreaker(
      rootPath,
      logger,
      config,
      () => void this.flush(),
      () => this.started,
    );

    if (config.retention) {
      this.squashManager = new SquashManager(
        rootPath,
        config.retention,
        logger,
        {
          branch: config.branch,
          lock: this.lock,
          flushInHold: () => this.queue.flushInHold(),
          remoteUrl,
          accessToken,
        },
      );
    }
  }

  get lastPushTime(): string | null {
    return this.committer.lastPushTime;
  }

  get pushErrors(): readonly PushError[] {
    return this.committer.pushErrors;
  }

  /** Current circuit breaker state and backlog, for /vcs/status. */
  get breakerState(): VcsBreakerState {
    return {
      ...this.breaker.snapshot(),
      pendingCount: this.queue.backlog,
    };
  }

  /**
   * Begin accepting file changes after startup maintenance under the lock
   * (never a checkout, D167); start the hourly sweep and squash. Baseline
   * mode lasts until {@link endBaseline}.
   */
  async start(): Promise<void> {
    await this.lock.run('startup', () =>
      runStartupMaintenance(this.rootPath, this.config, this.logger),
    );
    this.sweepTimer = sweepOnSchedule(this.rootPath, this.lock, this.logger);
    this.started = true;
    this.squashManager?.start();
    this.logger.info({ root: this.rootPath }, 'VcsManager started');
  }

  /**
   * Signal that the initial filesystem scan is complete.
   * Clears the baseline flag so subsequent commits use normal "watcher: batch" messages.
   */
  endBaseline(): void {
    this.isBaseline = false;
  }

  /**
   * Add a file to the pending set and start the throttle timer.
   * If the pending set reaches maxBatchSize, commit a batch immediately.
   *
   * The circuit breaker is intentionally not reset here: recovery is
   * time-based, so a busy root cannot hammer a deterministic failure.
   *
   * @param filePath - Absolute path of the changed file.
   */
  fileChanged(filePath: string): void {
    if (this.started) this.queue.add(filePath);
  }

  /**
   * Record reversion metadata so the next commit uses a revert-prefixed message.
   *
   * @param reversion - The reversion metadata to record.
   */
  addPendingReversion(reversion: PendingReversion): void {
    this.pendingReversions.push(reversion);
  }

  /**
   * Queue a deleted file. Staging records the deletion if git tracks it.
   *
   * @param filePath - Absolute path of the deleted file.
   */
  handleUnlink(filePath: string): void {
    this.fileChanged(filePath);
  }

  /** Commit all pending files now, in batches of at most maxBatchSize. */
  async flush(): Promise<void> {
    await this.queue.flush();
  }

  /** Stop accepting file changes, flush pending, and clean up timers. */
  async stop(): Promise<void> {
    this.started = false;
    this.squashManager?.stop();
    this.breaker.stop();
    if (this.sweepTimer !== undefined) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    await this.flush();
    this.logger.info({ root: this.rootPath }, 'VcsManager stopped');
  }

  /** Run a squash now (as the cron does); undefined when retention is off. */
  runSquash(): ReturnType<SquashManager['runSquash']> | undefined {
    return this.squashManager?.runSquash();
  }

  /**
   * Add tracked-but-deleted paths (`git ls-files --deleted`) in this
   * manager's watch scope to pending, so the next commit (typically the
   * baseline) records deletions made while nothing was watching (#249).
   *
   * @param isInScope - Returns true if the absolute path routes to this
   *   manager (the coordinator's routing and watch-scope logic).
   */
  async reconcileDeletions(
    isInScope: (absolutePath: string) => boolean,
  ): Promise<void> {
    try {
      const deleted = (await listDeletedTrackedPaths(this.rootPath)).filter(
        isInScope,
      );
      this.queue.retain(deleted);
      if (deleted.length > 0) {
        this.logger.info(
          { root: this.rootPath, count: deleted.length },
          'VCS startup reconciliation — queued tracked deletions',
        );
      }
    } catch (error) {
      this.logger.warn(
        { root: this.rootPath, err: normalizeError(error) },
        'VCS startup deletion reconciliation failed',
      );
    }
  }

  /**
   * Commit a batch (the caller holds the lock) with index.lock retry,
   * stale lock removal and the circuit breaker. A failed batch is always
   * retained.
   *
   * @returns true on success (including "nothing staged").
   */
  private async commitBatch(files: string[]): Promise<boolean> {
    if (files.length === 0) return true;

    if (!this.breaker.admit()) {
      this.queue.retain(files);
      return false;
    }

    try {
      const unstaged = await this.committer.commitWithRetry(files, {
        isBaseline: this.isBaseline,
        pendingReversions: this.pendingReversions,
      });
      this.pendingReversions.length = 0;
      if (unstaged.length > 0) {
        // Timed out even alone or past the budget: one failure (D72).
        this.onCommitFailure(
          unstaged,
          new Error(`git timed out staging ${String(unstaged.length)} path(s)`),
        );
        return false;
      }
      this.breaker.succeeded();
      return true;
    } catch (error) {
      this.onCommitFailure(files, error);
      return false;
    }
  }

  private onCommitFailure(files: string[], error: unknown): void {
    const err = normalizeError(error);
    this.queue.retain(files);
    this.logger.warn(
      { root: this.rootPath, fileCount: files.length },
      'Re-queued files after commit failure',
    );
    this.logger.error({ root: this.rootPath, err }, 'VCS commit failed');

    // Not tripped: restart the throttle so re-queued files get retried.
    if (!this.breaker.failed(err.message, this.queue.queued)) {
      this.queue.startThrottle();
    }
  }
}
