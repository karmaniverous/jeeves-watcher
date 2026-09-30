/**
 * @module vcs/VcsManager
 * Per-root VCS manager for git-backed content versioning.
 */

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';
import { stageBatch } from './batchStaging';
import {
  type CircuitBreakerSnapshot,
  CommitCircuitBreaker,
} from './CommitCircuitBreaker';
import { CommitMessageBuilder } from './CommitMessageBuilder';
import type { CommitMessageGenerator } from './CommitMessageGenerator';
import { isIndexLockError } from './gitExec';
import {
  gitCommit,
  hasStagedChanges,
  listDeletedTrackedPaths,
} from './gitIndex';
import {
  detectStaleGitOperation,
  removeStaleIndexLock,
  STALE_OPERATION_HINT,
} from './gitRepoState';
import { SquashManager } from './SquashManager';
import type { PendingReversion, PushError } from './types';
import { detectAndRecoverOrphanBranch } from './vcsBootstrap';
import { pushToRemote } from './vcsPush';

export type { PendingReversion, PushError };

/** Per-root circuit breaker state, exposed via /vcs/status. */
export interface VcsBreakerState extends CircuitBreakerSnapshot {
  /** Files queued or in flight, not yet committed. */
  pendingCount: number;
}

/**
 * Per-root VCS manager for git-backed content versioning.
 *
 * Each VCS-enabled watch root gets its own VcsManager instance, which owns
 * a throttled commit pipeline: file changes are batched, staged, committed
 * (with optional AI-generated messages), and optionally pushed to a remote.
 *
 * Concurrency: only one commit is in-flight at a time per root. Index.lock
 * contention is handled with exponential backoff retries (D10). Failed
 * batches are always retained; a circuit breaker spaces out retries of a
 * persistently failing root (#249).
 */
export class VcsManager {
  readonly config: VcsConfig;
  readonly rootPath: string;
  readonly remoteUrl: string | undefined;
  private readonly accessToken: string | undefined;
  private readonly logger: pino.Logger;
  private readonly commitMessageBuilder: CommitMessageBuilder;
  private readonly breaker: CommitCircuitBreaker;
  private readonly pending: Set<string> = new Set();
  private readonly pendingReversions: PendingReversion[] = [];
  private readonly _pushErrors: PushError[] = [];
  private readonly squashManager: SquashManager | undefined;
  private throttleTimer: ReturnType<typeof setTimeout> | undefined;
  private breakerRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private commitInFlight: Promise<void> = Promise.resolve();
  private inFlightFileCount = 0;
  private started = false;
  private paused = false;
  private isBaseline = true;
  private _lastPushTime: string | null = null;

  constructor(
    rootPath: string,
    config: VcsConfig,
    logger: pino.Logger,
    commitMessageGenerator?: CommitMessageGenerator,
    remoteUrl?: string,
    accessToken?: string,
  ) {
    this.rootPath = rootPath;
    this.config = config;
    this.logger = logger;
    this.remoteUrl = remoteUrl;
    this.accessToken = accessToken;

    this.commitMessageBuilder = new CommitMessageBuilder(
      rootPath,
      logger,
      commitMessageGenerator,
    );
    this.breaker = new CommitCircuitBreaker(
      config.maxConsecutiveFailures,
      config.circuitBreakerCooldownMs,
    );

    if (config.retention) {
      this.squashManager = new SquashManager(
        rootPath,
        config.retention,
        logger,
        {
          branch: config.branch,
          pauseCommits: () => this.pause(),
          resumeCommits: () => {
            this.resume();
          },
          remoteUrl,
          accessToken,
        },
      );
    }
  }

  get lastPushTime(): string | null {
    return this._lastPushTime;
  }

  get pushErrors(): readonly PushError[] {
    return this._pushErrors;
  }

  /** Current circuit breaker state and backlog, for /vcs/status. */
  get breakerState(): VcsBreakerState {
    return {
      ...this.breaker.snapshot(),
      pendingCount: this.pending.size + this.inFlightFileCount,
    };
  }

  /**
   * Begin accepting file changes. Sets the manager to started state and
   * starts the squash manager if configured.
   *
   * Performs startup orphan detection/recovery before starting the squash
   * manager, ensuring the repo is on the configured branch, and reports
   * (never clears) an abandoned cherry-pick, rebase, or merge.
   *
   * Baseline mode (commit prefix `"baseline:"`) remains active until
   * {@link endBaseline} is called by the coordinator after the initial scan.
   */
  async start(): Promise<void> {
    // Bug 6: Detect and recover from orphan branches before normal operations
    try {
      await detectAndRecoverOrphanBranch(
        this.rootPath,
        this.config.branch,
        this.logger,
      );
    } catch (error) {
      this.logger.error(
        { root: this.rootPath, err: normalizeError(error) },
        'Orphan branch recovery failed — continuing with current state',
      );
    }

    const marker = await detectStaleGitOperation(this.rootPath);
    if (marker !== undefined) {
      this.logger.error(
        { root: this.rootPath, marker },
        `Stale in-progress git operation detected (.git/${marker}) — squash retention will refuse to run until you ${STALE_OPERATION_HINT}`,
      );
    }

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
    if (!this.started) return;
    this.pending.add(filePath);

    if (this.pending.size >= this.config.maxBatchSize) {
      this.clearThrottle();
      this.enqueueBatch(this.takeBatch());
      if (this.pending.size > 0) this.resetThrottle();
      return;
    }

    this.resetThrottle();
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

  /**
   * Pause the commit pipeline. Drains pending commits via flush(), then
   * sets a flag that makes commitBatch queue instead of execute.
   * Used by SquashManager to coordinate squash operations.
   */
  async pause(): Promise<void> {
    await this.flush();
    this.paused = true;
    this.logger.debug({ root: this.rootPath }, 'VcsManager paused');
  }

  /**
   * Resume the commit pipeline after a pause.
   * Re-enables normal commit operations and starts a throttle timer
   * if there are pending files that accumulated during the pause.
   */
  resume(): void {
    this.paused = false;
    this.logger.debug({ root: this.rootPath }, 'VcsManager resumed');
    if (this.pending.size > 0) this.resetThrottle();
  }

  /**
   * Commit all pending files now, in batches of at most maxBatchSize.
   */
  async flush(): Promise<void> {
    this.clearThrottle();
    while (this.pending.size > 0) {
      this.enqueueBatch(this.takeBatch());
    }
    await this.commitInFlight;
  }

  /**
   * Stop accepting file changes, flush pending, and clean up timers.
   */
  async stop(): Promise<void> {
    this.started = false;
    this.squashManager?.stop();
    this.clearBreakerRetry();
    await this.flush();
    this.logger.info({ root: this.rootPath }, 'VcsManager stopped');
  }

  /**
   * Add tracked-but-deleted paths (`git ls-files --deleted`) in this
   * manager's watch scope to pending, so the next commit (typically the
   * baseline) records deletions that happened while nothing was watching.
   * Called by the coordinator before flush/endBaseline on startup. See #249.
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
      for (const path of deleted) this.pending.add(path);
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

  /** Take up to maxBatchSize files from the pending set. */
  private takeBatch(): string[] {
    const batch = [...this.pending].slice(0, this.config.maxBatchSize);
    for (const item of batch) this.pending.delete(item);
    return batch;
  }

  /** Chain a batch behind the in-flight commit, tracking it as backlog. */
  private enqueueBatch(batch: string[]): void {
    this.inFlightFileCount += batch.length;
    this.commitInFlight = this.commitInFlight.then(async () => {
      try {
        await this.commitBatch(batch);
      } finally {
        this.inFlightFileCount -= batch.length;
      }
    });
  }

  /** Put files back in the pending set. Pending is a set, so this cannot grow it past the distinct paths seen. */
  private retain(files: string[]): void {
    for (const f of files) this.pending.add(f);
  }

  private clearThrottle(): void {
    if (this.throttleTimer === undefined) return;
    clearTimeout(this.throttleTimer);
    this.throttleTimer = undefined;
  }

  /**
   * Start the throttle timer to fire flush() after commitThrottleMs.
   * If a timer is already running, do not reset it — this is throttle, not debounce.
   */
  private resetThrottle(): void {
    if (this.throttleTimer !== undefined) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = undefined;
      void this.flush();
    }, this.config.commitThrottleMs);
  }

  private clearBreakerRetry(): void {
    if (this.breakerRetryTimer === undefined) return;
    clearTimeout(this.breakerRetryTimer);
    this.breakerRetryTimer = undefined;
  }

  /**
   * Ensure a timer will flush pending files when the breaker's cooldown
   * elapses, without needing a new file-change event.
   */
  private scheduleBreakerRetry(): void {
    if (!this.started || this.breakerRetryTimer !== undefined) return;
    this.breakerRetryTimer = setTimeout(() => {
      this.breakerRetryTimer = undefined;
      void this.flush();
    }, this.breaker.remainingCooldownMs());
  }

  /**
   * Commit a batch with index.lock retry, stale lock detection, pause
   * support, and the circuit breaker. A failed batch is always retained.
   */
  private async commitBatch(files: string[]): Promise<void> {
    if (files.length === 0) return;

    if (this.paused) {
      this.retain(files);
      this.logger.debug(
        { root: this.rootPath, fileCount: files.length },
        'VcsManager paused — files re-queued',
      );
      return;
    }

    if (this.breaker.isTripped) {
      if (this.breaker.remainingCooldownMs() > 0) {
        this.retain(files);
        this.scheduleBreakerRetry();
        return;
      }
      this.logger.info(
        { root: this.rootPath },
        'VCS circuit breaker half-open — attempting recovery commit',
      );
    }

    try {
      await removeStaleIndexLock(
        this.rootPath,
        this.config.staleLockThresholdMs,
        this.logger,
      );
      const committed = await retry(
        (attempt) => this.tryCommit(files, attempt),
        {
          attempts: 4,
          baseDelayMs: 500,
          maxDelayMs: 2000,
          // Only index.lock contention is transient. Anything else fails on
          // the first attempt with its real message. See #249.
          shouldRetry: isIndexLockError,
          onRetry: ({ attempt, delayMs }) => {
            this.logger.warn(
              { root: this.rootPath, attempt, delay: delayMs },
              'index.lock contention, retrying',
            );
          },
        },
      );

      if (!committed) {
        this.logger.info(
          { root: this.rootPath, fileCount: files.length },
          'VCS commit skipped — nothing staged',
        );
      }
      this.onCommitSuccess();
    } catch (error) {
      this.onCommitFailure(files, error);
    }
  }

  /**
   * One commit attempt: stage, skip if nothing is staged, commit, push.
   *
   * @returns true if a commit was created; false for a no-op.
   */
  private async tryCommit(files: string[], attempt: number): Promise<boolean> {
    await stageBatch(files, this.rootPath, this.logger);

    // "Nothing staged" is a no-op, detected without parsing git's text.
    if (!(await hasStagedChanges(this.rootPath))) return false;

    // Build message after staging so getStagedDiff can see the changes.
    // Skip AI for baselines and retries — use template directly.
    const message =
      this.isBaseline || attempt > 1
        ? this.commitMessageBuilder.buildTemplateMessage(
            files.length,
            this.isBaseline,
            this.pendingReversions,
          )
        : await this.commitMessageBuilder.buildCommitMessage(
            files,
            this.isBaseline,
            this.pendingReversions,
          );
    this.pendingReversions.length = 0;

    const hash = await gitCommit(this.rootPath, message);
    this.logger.info(
      { root: this.rootPath, hash, fileCount: files.length },
      'VCS commit created',
    );

    const pushTime = await pushToRemote(
      this.rootPath,
      this.remoteUrl,
      this.accessToken,
      this._pushErrors,
      this.logger,
    );
    if (pushTime) this._lastPushTime = pushTime;
    return true;
  }

  private onCommitSuccess(): void {
    if (!this.breaker.recordSuccess()) return;
    this.clearBreakerRetry();
    this.logger.info(
      { root: this.rootPath },
      'VCS circuit breaker recovered — resuming normal operation',
    );
  }

  private onCommitFailure(files: string[], error: unknown): void {
    const err = normalizeError(error);
    this.retain(files);
    this.logger.warn(
      { root: this.rootPath, fileCount: files.length },
      'Re-queued files after commit failure',
    );
    this.logger.error({ root: this.rootPath, err }, 'VCS commit failed');

    if (!this.breaker.recordFailure(err.message)) {
      // Bug 2: Restart throttle timer so re-queued files get retried
      this.resetThrottle();
      return;
    }

    this.logger.error(
      {
        root: this.rootPath,
        consecutiveFailures: this.breaker.snapshot().consecutiveFailures,
        pendingCount: this.pending.size,
        cooldownMs: this.config.circuitBreakerCooldownMs,
      },
      'VCS circuit breaker tripped — pending files retained, will retry after cooldown',
    );
    this.scheduleBreakerRetry();
  }
}
