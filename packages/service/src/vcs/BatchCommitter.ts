/**
 * @module vcs/BatchCommitter
 * One commit attempt for a batch, run while the caller holds RootGitLock: finish a leftover untrack, stage (D174, D175, D80), untrack over-cap files in their own commit (D147), commit with a template or AI message, then push. Runs git.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';
import { stageBatch, type StagingOptions } from './batchStaging';
import {
  bisectionDeadline,
  type BisectionResult,
  stageWithBisection,
} from './bisectStaging';
import type { CommitMessageBuilder } from './CommitMessageBuilder';
import { isIndexLockError, pathListTimeoutMs } from './gitExec';
import { gitCommit, hasStagedChanges } from './gitIndex';
import { isGitTimeout } from './gitProcess';
import { removeStaleIndexLock } from './gitRepoState';
import type { OverCapWarnings } from './OverCapWarnings';
import { cleanTempFilesAfterKill, listTempFiles } from './tempFiles';
import { listTracked } from './trackedCheck';
import type { PendingReversion, PushError } from './types';
import { untrackPaths } from './untrack';
import { recoverUntrackPending } from './untrackPending';
import { pushToRemote } from './vcsPush';

/** Dependencies of a {@link BatchCommitter}. */
export interface BatchCommitterDeps {
  /** Repository root. */
  rootPath: string;
  /** Logger. */
  logger: pino.Logger;
  /** Commit message builder (template or AI). */
  messageBuilder: CommitMessageBuilder;
  /** Remote to push to, if any. */
  remoteUrl?: string;
  /** Token for HTTPS pushes. */
  accessToken?: string;
  /** Age after which an `index.lock` is removed before an attempt. */
  staleLockThresholdMs: number;
  /** `vcs.maxFileBytes` in bytes, read at each staging (D67). */
  getMaxFileBytes: () => number;
  /** Once-per-path over-cap warnings. */
  warnings: OverCapWarnings;
  /** Path-list timeout override (tests only). */
  timeoutFor?: (paths: number) => number;
}

/** Context of one attempt. */
export interface CommitContext {
  /** Attempt number (1 first); retries use the template message. */
  attempt: number;
  /** Baseline mode (template `baseline:` message). */
  isBaseline: boolean;
  /** Reversions to describe in the message. */
  pendingReversions: readonly PendingReversion[];
  /**
   * Epoch ms the batch's staging must end by: one budget for all its
   * attempts, bisection included (D72).
   */
  deadline: number;
}

/** Index.lock retry policy: only lock contention is transient (#249). */
const LOCK_RETRY = { attempts: 4, baseDelayMs: 500, maxDelayMs: 2000 };

/** Outcome of one commit attempt. */
export interface CommitOutcome {
  /** Whether anything was committed (batch or untrack commit). */
  committed: boolean;
  /** Paths left unstaged by timeouts. */
  unstaged: string[];
}

/** Message of the over-cap untrack commit. */
function overCapMessage(count: number): string {
  return `watcher: untrack ${String(count)} file${count === 1 ? '' : 's'} over vcs.maxFileBytes`;
}

/** Commits batches for one root. */
export class BatchCommitter {
  /** Push failures, newest last (for `/vcs/status`). */
  readonly pushErrors: PushError[] = [];
  private lastPush: string | null = null;

  constructor(private readonly deps: BatchCommitterDeps) {}

  /** Path-list timeout (the test override, or the real one). */
  private get timeoutFor(): (paths: number) => number {
    return this.deps.timeoutFor ?? pathListTimeoutMs;
  }

  /** ISO time of the last successful push, or null. */
  get lastPushTime(): string | null {
    return this.lastPush;
  }

  /**
   * Remove a stale `index.lock`, then {@link commit} with retries on
   * `index.lock` contention only; anything else fails on the first attempt
   * with its real message (#249). Retries use the template message.
   *
   * @param files - Absolute paths in the batch.
   * @param context - Baseline flag and reversions.
   * @returns Paths left unstaged by timeouts (to re-queue, D72).
   */
  async commitWithRetry(
    files: string[],
    context: Omit<CommitContext, 'attempt' | 'deadline'>,
  ): Promise<string[]> {
    const { rootPath, logger } = this.deps;
    const deadline = bisectionDeadline(files.length, this.timeoutFor);
    await removeStaleIndexLock(
      rootPath,
      this.deps.staleLockThresholdMs,
      logger,
    );
    const { committed, unstaged } = await retry(
      (attempt) => this.commit(files, { ...context, attempt, deadline }),
      {
        ...LOCK_RETRY,
        shouldRetry: isIndexLockError,
        onRetry: ({ attempt, delayMs }) => {
          logger.warn(
            { root: rootPath, attempt, delay: delayMs },
            'index.lock contention, retrying',
          );
        },
      },
    );
    if (!committed) {
      logger.info(
        { root: rootPath, fileCount: files.length },
        'VCS commit skipped — nothing staged',
      );
    }
    return unstaged;
  }

  /**
   * Stage and commit `files`, then push.
   *
   * @param files - Absolute paths in the batch.
   * @param context - Attempt number, baseline flag and reversions.
   * @returns Whether anything was committed (batch or untrack commit), and
   *   the paths left unstaged by timeouts.
   */
  async commit(
    files: string[],
    context: CommitContext,
  ): Promise<CommitOutcome> {
    const { rootPath, logger } = this.deps;
    await recoverUntrackPending(rootPath, logger);

    const { overCap, unstaged } = await this.stage(files, context.deadline);
    const untrackCommit = await this.untrackOverCap(overCap);

    // "Nothing staged" is a no-op, detected without parsing git's text.
    const staged = await hasStagedChanges(rootPath);
    if (staged) {
      // Built after staging so the AI sees the staged diff; baselines and
      // retries use the template. The generator has its own 15 s timeout.
      const message =
        context.isBaseline || context.attempt > 1
          ? this.deps.messageBuilder.buildTemplateMessage(
              files.length,
              context.isBaseline,
              context.pendingReversions,
            )
          : await this.deps.messageBuilder.buildCommitMessage(
              files,
              context.isBaseline,
              context.pendingReversions,
            );
      const hash = await gitCommit(rootPath, message);
      logger.info(
        { root: rootPath, hash, fileCount: files.length },
        'VCS commit created',
      );
    }
    if (!staged && untrackCommit === undefined) {
      return { committed: false, unstaged };
    }

    await this.push();
    return { committed: true, unstaged };
  }

  /**
   * Push to the remote (if any), recording the time or the failure for
   * `/vcs/status`. Never throws. The caller holds RootGitLock.
   */
  async push(): Promise<void> {
    const pushTime = await pushToRemote(
      this.deps.rootPath,
      this.deps.remoteUrl,
      this.deps.accessToken,
      this.pushErrors,
      this.deps.logger,
    );
    if (pushTime) this.lastPush = pushTime;
  }

  /**
   * Stage with bisection on timeouts (D72). Each attempt snapshots git's
   * temp files first; after a killed attempt, new ones are deleted in the
   * background once they stop changing (D66).
   */
  private stage(files: string[], deadline: number): Promise<BisectionResult> {
    const { rootPath, logger } = this.deps;
    const options: Omit<StagingOptions, 'timeoutFor'> = {
      maxFileBytes: this.deps.getMaxFileBytes(),
      warnings: this.deps.warnings,
    };
    return stageWithBisection(
      files,
      async (paths, timeoutFor) => {
        const snapshot = new Set(await listTempFiles(rootPath));
        try {
          return await stageBatch(paths, rootPath, logger, {
            ...options,
            timeoutFor,
          });
        } catch (error) {
          if (isGitTimeout(error)) this.cleanAfterKill(snapshot);
          throw error;
        }
      },
      {
        timeoutFor: this.timeoutFor,
        deadline,
        onTimeout: (paths) => {
          logger.warn(
            { root: rootPath, count: paths.length },
            'git timed out while staging; bisecting the batch',
          );
        },
      },
    );
  }

  /** Background post-kill temp-file cleanup (not under the lock). */
  private cleanAfterKill(snapshot: ReadonlySet<string>): void {
    const { rootPath, logger } = this.deps;
    cleanTempFilesAfterKill(rootPath, snapshot).then(
      (deleted) => {
        if (deleted.length > 0) {
          logger.info(
            { root: rootPath, count: deleted.length },
            'Removed temp files left by a killed git call',
          );
        }
      },
      (error: unknown) => {
        logger.warn(
          { root: rootPath, err: normalizeError(error) },
          'Temp-file cleanup after a killed git call failed',
        );
      },
    );
  }

  /**
   * Untrack tracked files over the cap in their own commit, before the
   * batch commit (D80, D147, D163).
   *
   * @returns The untrack commit, if one was made.
   */
  private async untrackOverCap(paths: string[]): Promise<string | undefined> {
    if (paths.length === 0) return undefined;
    const { rootPath, logger } = this.deps;
    const { commit, untracked } = await untrackPaths(rootPath, {
      select: (env) => listTracked(rootPath, paths, { env }),
      message: () => overCapMessage(paths.length),
    });
    logger.info(
      { root: rootPath, commit, count: untracked.length },
      'Untracked files over vcs.maxFileBytes',
    );
    return commit;
  }
}
