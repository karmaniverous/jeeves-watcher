/**
 * @module vcs/VcsManager
 * Per-root VCS manager for git-backed content versioning.
 */

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';
import { CommitMessageBuilder } from './CommitMessageBuilder';
import type { CommitMessageGenerator } from './CommitMessageGenerator';
import { execFileAsync, gitAddViaStdin } from './gitExec';
import { SquashManager } from './SquashManager';
import type { PendingReversion, PushError } from './types';
import { pushToRemote } from './vcsPush';

export type { PendingReversion, PushError };

/**
 * Per-root VCS manager for git-backed content versioning.
 *
 * Each VCS-enabled watch root gets its own VcsManager instance, which owns
 * a debounced commit pipeline: file changes are batched, staged, committed
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
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private commitInFlight: Promise<void> = Promise.resolve();
  private started = false;
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
        remoteUrl,
        accessToken,
      );
    }
  }

  get lastPushTime(): string | null {
    return this._lastPushTime;
  }

  get pushErrors(): readonly PushError[] {
    return this._pushErrors;
  }

  /**
   * Begin accepting file changes. Sets the manager to started state and
   * starts the squash manager if configured.
   *
   * Baseline mode (commit prefix `"baseline:"`) remains active until
   * {@link endBaseline} is called by the coordinator after the initial scan.
   */
  start(): void {
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
   * Add a file to the pending set and reset the debounce timer.
   * If the pending set exceeds maxBatchSize, flush immediately.
   *
   * @param filePath - Absolute path of the changed file.
   */
  fileChanged(filePath: string): void {
    if (!this.started) return;

    this.pending.add(filePath);

    if (this.pending.size >= this.config.maxBatchSize) {
      this.clearDebounce();
      const batch = this.takeBatch(this.config.maxBatchSize);
      this.commitInFlight = this.commitInFlight.then(() =>
        this.commitBatch(batch),
      );
      if (this.pending.size > 0) {
        this.resetDebounce();
      }
      return;
    }

    this.resetDebounce();
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
   * Flush all pending files immediately.
   */
  async flush(): Promise<void> {
    this.clearDebounce();
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
    await this.flush();
    this.logger.info({ root: this.rootPath }, 'VcsManager stopped');
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
   * Clear the debounce timer.
   */
  private clearDebounce(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  /**
   * Reset the debounce timer to fire flush() after commitDebounceMs.
   */
  private resetDebounce(): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.flush();
    }, this.config.commitDebounceMs);
  }

  /**
   * Commit a batch of files to the git repo with index.lock retry.
   */
  private async commitBatch(files: string[]): Promise<void> {
    if (files.length === 0) return;

    try {
      await retry(
        async (attempt) => {
          await gitAddViaStdin(files, this.rootPath);

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
          await execFileAsync('git', ['commit', '-m', message], {
            cwd: this.rootPath,
          });

          const { stdout: hashOut } = await execFileAsync(
            'git',
            ['rev-parse', '--short', 'HEAD'],
            { cwd: this.rootPath },
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
        },
        {
          attempts: 4,
          baseDelayMs: 500,
          maxDelayMs: 2000,
          onRetry: ({ attempt, delayMs }) => {
            this.logger.warn(
              { root: this.rootPath, attempt, delay: delayMs },
              'index.lock contention, retrying',
            );
          },
        },
      );
    } catch (error) {
      for (const f of files) {
        this.pending.add(f);
      }
      this.logger.warn(
        { root: this.rootPath, fileCount: files.length },
        'Re-queued files after commit failure',
      );
      this.logger.error(
        { root: this.rootPath, err: normalizeError(error) },
        'VCS commit failed',
      );
    }
  }
}
