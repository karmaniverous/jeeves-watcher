/**
 * @module vcs/VcsManager
 * Per-root VCS manager for git-backed content versioning.
 */

import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';
import { CommitMessageBuilder } from './CommitMessageBuilder';
import type { CommitMessageGenerator } from './CommitMessageGenerator';
import {
  execFileAsync,
  GIT_TIMEOUT_STANDARD,
  gitAddViaStdin,
  gitArgs,
  gitRmCachedViaStdin,
  hasStagedChanges,
  isIndexLockError,
  listDeletedTrackedPaths,
  pathKey,
} from './gitExec';
import { detectStaleGitOperation, SquashManager } from './SquashManager';
import type { PendingReversion, PushError } from './types';
import { detectAndRecoverOrphanBranch } from './vcsBootstrap';
import { pushToRemote } from './vcsPush';

export type { PendingReversion, PushError };

/** Per-root circuit breaker state, exposed via /vcs/status. */
export interface VcsBreakerState {
  /** Consecutive commit failures since the last success. */
  consecutiveFailures: number;
  /** Whether the breaker is currently tripped (cooling down). */
  tripped: boolean;
  /** ISO timestamp of the last trip, or null if never tripped. */
  trippedAt: string | null;
  /** Message of the most recent failure, or null. */
  lastError: string | null;
  /** Number of files currently pending (queued, not yet committed). */
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
 * contention is handled with exponential backoff retries (D10).
 */
export class VcsManager {
  readonly config: VcsConfig;
  readonly rootPath: string;
  readonly remoteUrl: string | undefined;
  private readonly accessToken: string | undefined;
  private readonly logger: pino.Logger;
  private readonly commitMessageBuilder: CommitMessageBuilder;
  private readonly pending: Set<string> = new Set();
  private readonly pendingReversions: PendingReversion[] = [];
  private readonly _pushErrors: PushError[] = [];
  private readonly squashManager: SquashManager | undefined;
  private throttleTimer: ReturnType<typeof setTimeout> | undefined;
  private commitInFlight: Promise<void> = Promise.resolve();
  private consecutiveCommitFailures = 0;
  // Circuit breaker (Bug: never discard pending files, see #249): once
  // tripped, batches are re-queued (not dropped) and retried after a
  // time-based cooldown rather than waiting for a new file event.
  private breakerTripped = false;
  private trippedAtMs = 0;
  private breakerLastError: string | undefined;
  private breakerRetryTimer: ReturnType<typeof setTimeout> | undefined;
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

    if (config.retention) {
      this.squashManager = new SquashManager(
        rootPath,
        config.retention,
        logger,
        {
          branch: config.branch,
          pauseCommits: () => {
            return this.pause();
          },
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

  /** Current circuit breaker state, for /vcs/status. */
  get breakerState(): VcsBreakerState {
    return {
      consecutiveFailures: this.consecutiveCommitFailures,
      tripped: this.breakerTripped,
      trippedAt: this.breakerTripped
        ? new Date(this.trippedAtMs).toISOString()
        : null,
      lastError: this.breakerLastError ?? null,
      pendingCount: this.pending.size,
    };
  }

  /**
   * Begin accepting file changes. Sets the manager to started state and
   * starts the squash manager if configured.
   *
   * Performs startup orphan detection/recovery before starting the squash
   * manager, ensuring the repo is on the configured branch.
   *
   * Baseline mode (commit prefix `"baseline:"`) remains active until
   * {@link endBaseline} is called by the coordinator after the initial scan.
   */
  async start(): Promise<void> {
    // Bug 6: Detect and recover from orphan branches before normal operations
    const branch = this.config.branch;
    try {
      await detectAndRecoverOrphanBranch(this.rootPath, branch, this.logger);
    } catch (error) {
      this.logger.error(
        { root: this.rootPath, err: normalizeError(error) },
        'Orphan branch recovery failed — continuing with current state',
      );
    }

    // #249: report (never auto-clear) an abandoned cherry-pick, rebase, or
    // merge. Squash refuses to run while one is present.
    const staleOperation = await detectStaleGitOperation(this.rootPath);
    if (staleOperation !== undefined) {
      this.logger.error(
        { root: this.rootPath, marker: staleOperation },
        `Stale in-progress git operation detected (.git/${staleOperation}) — squash retention will refuse to run until it is resolved manually (e.g. git cherry-pick --quit / git rebase --abort / git merge --abort)`,
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
   * If the pending set exceeds maxBatchSize, flush immediately.
   *
   * @param filePath - Absolute path of the changed file.
   */
  fileChanged(filePath: string): void {
    if (!this.started) return;

    // Note: the circuit breaker is intentionally NOT reset here. Resetting
    // on every new file change defeated the time-based cooldown (a busy
    // root would re-trip almost immediately on the same deterministic
    // error). Recovery is time-based; see commitBatch() and
    // scheduleBreakerRetry(). See #249.
    this.pending.add(filePath);

    if (this.pending.size >= this.config.maxBatchSize) {
      this.clearThrottle();
      const batch = this.takeBatch(this.config.maxBatchSize);
      this.commitInFlight = this.commitInFlight.then(() =>
        this.commitBatch(batch),
      );
      if (this.pending.size > 0) {
        this.resetThrottle();
      }
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
   * Stage a file deletion and add to pending set.
   * git add handles deleted files when the file is gone from disk.
   *
   * @param filePath - Absolute path of the deleted file.
   */
  handleUnlink(filePath: string): void {
    if (!this.started) return;
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
    if (this.pending.size > 0) {
      this.resetThrottle();
    }
  }

  /**
   * Flush all pending files immediately.
   */
  async flush(): Promise<void> {
    this.clearThrottle();
    if (this.pending.size > 0) {
      const batch = [...this.pending];
      this.pending.clear();
      this.commitInFlight = this.commitInFlight.then(() =>
        this.commitBatch(batch),
      );
    }
    await this.commitInFlight;
  }

  /**
   * Stop accepting file changes, flush pending, and clean up timers.
   */
  async stop(): Promise<void> {
    this.started = false;
    this.squashManager?.stop();
    if (this.breakerRetryTimer !== undefined) {
      clearTimeout(this.breakerRetryTimer);
      this.breakerRetryTimer = undefined;
    }
    await this.flush();
    this.logger.info({ root: this.rootPath }, 'VcsManager stopped');
  }

  /**
   * Enumerate tracked-but-deleted paths (`git ls-files --deleted`) and add
   * the ones in this manager's watch scope to pending, so the next commit
   * (typically the baseline commit) records deletions that happened while
   * the process wasn't watching. Called by the coordinator before flush/
   * endBaseline on startup. See #249.
   *
   * @param isInScope - Returns true if the given absolute path routes to
   *   this manager (the coordinator's normal routing logic).
   */
  async reconcileDeletions(
    isInScope: (absolutePath: string) => boolean,
  ): Promise<void> {
    try {
      const deleted = await listDeletedTrackedPaths(
        this.rootPath,
        GIT_TIMEOUT_STANDARD,
      );
      let count = 0;
      for (const abs of deleted) {
        if (!isInScope(abs)) continue;
        this.pending.add(abs);
        count++;
      }
      if (count > 0) {
        this.logger.info(
          { root: this.rootPath, count },
          'VCS startup reconciliation — staged tracked deletions',
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
   * Take up to N items from the pending set.
   */
  private takeBatch(n: number): string[] {
    const batch: string[] = [];
    for (const item of this.pending) {
      if (batch.length >= n) break;
      batch.push(item);
    }
    for (const item of batch) {
      this.pending.delete(item);
    }
    return batch;
  }

  /**
   * Clear the throttle timer.
   */
  private clearThrottle(): void {
    if (this.throttleTimer !== undefined) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = undefined;
    }
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

  /**
   * Check for and remove stale index.lock files before retrying.
   */
  private async removeStaleLock(): Promise<void> {
    const lockPath = join(this.rootPath, '.git', 'index.lock');
    try {
      const lockStat = await stat(lockPath);
      const ageMs = Date.now() - lockStat.mtimeMs;
      if (ageMs > this.config.staleLockThresholdMs) {
        await rm(lockPath, { force: true });
        this.logger.warn(
          { root: this.rootPath, ageMs },
          'Removed stale index.lock',
        );
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(
          { root: this.rootPath, err: normalizeError(error) },
          'Unable to remove stale index.lock',
        );
      }
    }
  }

  /**
   * Split a batch into files that exist on disk (stage normally) and files
   * that are missing but tracked (stage the removal). Missing + untracked
   * paths are dropped (logged at debug) — a missing path must never fail
   * the batch. Uses a single `git ls-files --deleted` call, never one
   * process per file. See #249.
   */
  private async partitionMissingPaths(files: string[]): Promise<{
    existing: string[];
    missingTracked: string[];
  }> {
    const existing: string[] = [];
    const missing: string[] = [];
    await Promise.all(
      files.map(async (f) => {
        try {
          await stat(f);
          existing.push(f);
        } catch {
          missing.push(f);
        }
      }),
    );

    if (missing.length === 0) {
      return { existing, missingTracked: [] };
    }

    const deletedTracked = new Set(
      (await listDeletedTrackedPaths(this.rootPath, GIT_TIMEOUT_STANDARD)).map(
        (p) => pathKey(p),
      ),
    );
    const missingTracked: string[] = [];
    let droppedCount = 0;
    for (const f of missing) {
      if (deletedTracked.has(pathKey(f))) {
        missingTracked.push(f);
      } else {
        droppedCount++;
      }
    }

    if (droppedCount > 0) {
      this.logger.debug(
        { root: this.rootPath, count: droppedCount },
        'Dropping missing, untracked paths from batch',
      );
    }

    return { existing, missingTracked };
  }

  /**
   * Stage a batch: add existing files, stage removal of tracked-but-missing
   * files, and drop missing-untracked files. Never fails on a missing path.
   */
  private async stageBatch(files: string[]): Promise<void> {
    const { existing, missingTracked } =
      await this.partitionMissingPaths(files);
    if (existing.length > 0) {
      await gitAddViaStdin(existing, this.rootPath, GIT_TIMEOUT_STANDARD);
    }
    if (missingTracked.length > 0) {
      await gitRmCachedViaStdin(
        missingTracked,
        this.rootPath,
        GIT_TIMEOUT_STANDARD,
      );
    }
  }

  /** Reset the circuit breaker to its healthy state after a successful commit (or no-op). */
  private resetBreaker(): void {
    const wasTripped = this.breakerTripped;
    this.consecutiveCommitFailures = 0;
    this.breakerTripped = false;
    this.trippedAtMs = 0;
    this.breakerLastError = undefined;
    if (this.breakerRetryTimer !== undefined) {
      clearTimeout(this.breakerRetryTimer);
      this.breakerRetryTimer = undefined;
    }
    if (wasTripped) {
      this.logger.info(
        { root: this.rootPath },
        'VCS circuit breaker recovered — resuming normal operation',
      );
    }
  }

  /**
   * Re-queue files up to the maxBatchSize cap, logging (and dropping) any
   * overflow beyond the cap. The circuit breaker never silently discards a
   * whole batch — this is the only place files are dropped, and only when
   * pending already exceeds the configured cap.
   */
  private requeue(files: string[]): void {
    const cap = this.config.maxBatchSize;
    const toRequeue = files.slice(0, cap);
    const overflow = files.length - toRequeue.length;

    for (const f of toRequeue) {
      this.pending.add(f);
    }

    if (overflow > 0) {
      this.logger.warn(
        { root: this.rootPath, overflow, cap },
        'Re-queue cap exceeded — discarded overflow files',
      );
    }
  }

  /**
   * Ensure a timer exists that will retry pending files once the circuit
   * breaker's cooldown elapses, without needing a new file-change event.
   */
  private scheduleBreakerRetry(): void {
    if (!this.started || this.breakerRetryTimer !== undefined) return;
    const elapsed = Date.now() - this.trippedAtMs;
    const wait = Math.max(0, this.config.circuitBreakerCooldownMs - elapsed);
    this.breakerRetryTimer = setTimeout(() => {
      this.breakerRetryTimer = undefined;
      void this.flush();
    }, wait);
  }

  /**
   * Commit a batch of files to the git repo with index.lock retry,
   * stale lock detection, circuit breaker (re-queue + time-based cooldown),
   * pause support, and re-queue cap. See #249.
   */
  private async commitBatch(files: string[]): Promise<void> {
    if (files.length === 0) return;

    // Pause support: re-queue files without counting as failure
    if (this.paused) {
      for (const f of files) {
        this.pending.add(f);
      }
      this.logger.debug(
        { root: this.rootPath, fileCount: files.length },
        'VcsManager paused — files re-queued',
      );
      return;
    }

    // Circuit breaker: while cooling down, re-queue (never discard) and
    // ensure a cooldown timer is running. Once the cooldown elapses, allow
    // exactly one half-open attempt through.
    if (this.breakerTripped) {
      const elapsed = Date.now() - this.trippedAtMs;
      if (elapsed < this.config.circuitBreakerCooldownMs) {
        // No cap here: these files were just taken from pending and were never
        // attempted, so putting them all back cannot grow the set. Capping
        // would silently discard work while cooling down.
        for (const f of files) {
          this.pending.add(f);
        }
        this.scheduleBreakerRetry();
        return;
      }
      this.logger.info(
        { root: this.rootPath },
        'VCS circuit breaker half-open — attempting recovery commit',
      );
    }

    try {
      // Check for stale lock before first attempt
      await this.removeStaleLock();

      const result = await retry(
        async (attempt) => {
          await this.stageBatch(files);

          // Bug 1/5: "nothing staged" is a no-op, not a failure — checked via
          // `git diff --cached --quiet`, not by parsing porcelain text.
          const staged = await hasStagedChanges(
            this.rootPath,
            GIT_TIMEOUT_STANDARD,
          );
          if (!staged) return { committed: false } as const;

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
          await execFileAsync('git', gitArgs('commit', '-m', message), {
            cwd: this.rootPath,
            timeout: GIT_TIMEOUT_STANDARD,
          });

          const { stdout: hashOut } = await execFileAsync(
            'git',
            gitArgs('rev-parse', '--short', 'HEAD'),
            { cwd: this.rootPath, timeout: GIT_TIMEOUT_STANDARD },
          );
          const hash = hashOut.trim();
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
          return { committed: true } as const;
        },
        {
          attempts: 4,
          baseDelayMs: 500,
          maxDelayMs: 2000,
          // Only transient errors (index.lock contention) are retried.
          // Deterministic errors (bad pathspec, permission denied, etc.) fail
          // on the first attempt instead of burning 3 more retries under a
          // misleading "index.lock contention" warning. See #249.
          shouldRetry: isIndexLockError,
          onRetry: ({ attempt, delayMs }) => {
            this.logger.warn(
              { root: this.rootPath, attempt, delay: delayMs },
              'index.lock contention, retrying',
            );
          },
        },
      );

      if (!result.committed) {
        this.logger.info(
          { root: this.rootPath, fileCount: files.length },
          'VCS commit skipped — nothing staged',
        );
      }

      // Success (committed or no-op) — reset circuit breaker
      this.resetBreaker();
    } catch (error) {
      this.consecutiveCommitFailures++;
      this.breakerLastError = normalizeError(error).message;

      this.requeue(files);
      this.logger.warn(
        { root: this.rootPath, fileCount: files.length },
        'Re-queued files after commit failure',
      );
      this.logger.error(
        { root: this.rootPath, err: normalizeError(error) },
        'VCS commit failed',
      );

      if (
        this.consecutiveCommitFailures >= this.config.maxConsecutiveFailures
      ) {
        this.breakerTripped = true;
        this.trippedAtMs = Date.now();
        this.logger.error(
          {
            root: this.rootPath,
            consecutiveFailures: this.consecutiveCommitFailures,
            pendingCount: this.pending.size,
            cooldownMs: this.config.circuitBreakerCooldownMs,
          },
          'VCS circuit breaker tripped — pending files retained, will retry after cooldown',
        );
        this.scheduleBreakerRetry();
      } else {
        // Bug 2: Restart throttle timer so re-queued files get retried
        this.resetThrottle();
      }
    }
  }
}
