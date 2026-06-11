/**
 * @module vcs/VcsManager
 * Per-root VCS manager for git-backed content versioning.
 */

import { execFile } from 'node:child_process';
import { access, appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import type { CommitMessageGenerator } from './CommitMessageGenerator';

const execFileAsync = promisify(execFile);

/** Metadata for a pending reversion to include in the commit message. */
export interface PendingReversion {
  glob: string;
  commit: string;
  paths: string[];
}

/** Always-on .gitignore entries for VCS-managed watch roots. */
const ALWAYS_GITIGNORE_ENTRIES = [
  '.git/',
  'node_modules/',
  '.jeeves-watcher/',
  '.jeeves-metadata/',
];

/** Maximum retries for index.lock contention. */
const MAX_LOCK_RETRIES = 3;

/** Backoff delays in ms for index.lock retries. */
const LOCK_RETRY_DELAYS = [500, 1000, 2000];

/**
 * Check whether an error is caused by index.lock contention.
 */
function isIndexLockError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message || '';
  const stderr =
    'stderr' in error ? String((error as { stderr: unknown }).stderr) : '';
  return (
    message.includes('index.lock') ||
    stderr.includes('index.lock') ||
    message.includes('EEXIST') ||
    stderr.includes('EEXIST')
  );
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Push error record for status reporting. */
export interface PushError {
  timestamp: string;
  message: string;
}

/**
 * Per-root VCS manager for git-backed content versioning.
 * Constructor takes the resolved VCS config for one watch root.
 */
export class VcsManager {
  readonly config: VcsConfig;
  readonly rootPath: string;
  readonly remoteUrl: string | undefined;
  private readonly accessToken: string | undefined;
  private readonly logger: pino.Logger;
  private readonly commitMessageGenerator: CommitMessageGenerator | undefined;
  private readonly pending: Set<string> = new Set();
  private readonly pendingReversions: PendingReversion[] = [];
  private readonly _pushErrors: PushError[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private commitInFlight: Promise<void> = Promise.resolve();
  private started = false;
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
    this.commitMessageGenerator = commitMessageGenerator;
    this.remoteUrl = remoteUrl;
    this.accessToken = accessToken;
  }

  get lastPushTime(): string | null {
    return this._lastPushTime;
  }

  get pushErrors(): readonly PushError[] {
    return this._pushErrors;
  }

  /**
   * Check whether git is available on the system PATH.
   *
   * @returns true if git is available, false otherwise.
   */
  static async checkGitAvailable(): Promise<boolean> {
    try {
      await execFileAsync('git', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize a git repository at the given path if none exists.
   * Idempotent — does nothing if .git/ already exists.
   *
   * @param rootPath - Directory to initialize as a git repo.
   */
  static async initRepo(rootPath: string): Promise<void> {
    const gitDir = join(rootPath, '.git');
    try {
      await access(gitDir);
      // .git exists, nothing to do
    } catch {
      await execFileAsync('git', ['init'], { cwd: rootPath });
    }
  }

  /**
   * Ensure a .gitignore file exists at rootPath with all always-on entries.
   * Creates the file if missing. Appends only entries not already present.
   *
   * @param rootPath - Directory containing the .gitignore.
   * @param alwaysOnEntries - Additional always-on entries beyond the defaults.
   */
  static async ensureGitignore(
    rootPath: string,
    alwaysOnEntries: string[] = [],
  ): Promise<void> {
    const gitignorePath = join(rootPath, '.gitignore');
    const requiredEntries = [...ALWAYS_GITIGNORE_ENTRIES, ...alwaysOnEntries];

    let existingContent = '';
    try {
      existingContent = await readFile(gitignorePath, 'utf8');
    } catch {
      // File doesn't exist yet
    }

    const existingLines = new Set(
      existingContent.split('\n').map((line) => line.trim()),
    );
    const missing = requiredEntries.filter(
      (entry) => !existingLines.has(entry),
    );

    if (missing.length === 0) return;

    if (existingContent.length === 0) {
      await writeFile(gitignorePath, missing.join('\n') + '\n', 'utf8');
    } else {
      const prefix = existingContent.endsWith('\n') ? '' : '\n';
      await appendFile(
        gitignorePath,
        prefix + missing.join('\n') + '\n',
        'utf8',
      );
    }
  }

  /**
   * Begin accepting file changes. Sets up the debounce mechanism.
   */
  start(): void {
    this.started = true;
    this.logger.info({ root: this.rootPath }, 'VcsManager started');
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
      this.commitInFlight = this.commitBatch(batch);
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
    await this.commitInFlight;
    if (this.pending.size === 0) return;

    const batch = [...this.pending];
    this.pending.clear();
    await this.commitBatch(batch);
  }

  /**
   * Stop accepting file changes, flush pending, and clean up timers.
   */
  async stop(): Promise<void> {
    this.started = false;
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
   * Get the cached diff for staged files, for AI context.
   */
  private async getStagedDiff(): Promise<string> {
    try {
      const { stdout: stat } = await execFileAsync(
        'git',
        ['diff', '--cached', '--stat'],
        { cwd: this.rootPath },
      );
      const { stdout: patch } = await execFileAsync(
        'git',
        ['diff', '--cached'],
        { cwd: this.rootPath },
      );
      return `${stat}\n${patch}`;
    } catch {
      return '';
    }
  }

  /**
   * Build the template commit message (no AI).
   */
  private buildTemplateMessage(fileCount: number): string {
    if (this.pendingReversions.length === 0) {
      const timestamp = new Date().toISOString();
      return `watcher: batch ${timestamp} (${String(fileCount)} files)`;
    }

    // Count total reverted files across all pending reversions
    const revertedPaths = new Set(
      this.pendingReversions.flatMap((r) => r.paths),
    );
    const revertedCount = revertedPaths.size;
    const otherCount = fileCount - revertedCount;

    // Use the first reversion's glob and commit for the message
    const { glob, commit } = this.pendingReversions[0];
    const shortCommit = commit.slice(0, 7);

    let message = `revert: ${glob} to ${shortCommit} — restored ${String(revertedCount)} files`;
    if (otherCount > 0) {
      message += ` (+ ${String(otherCount)} other changes)`;
    }

    return message;
  }

  /**
   * Build the commit message, using AI when available with template fallback.
   */
  private async buildCommitMessage(files: string[]): Promise<string> {
    const fileCount = files.length;
    const templateMessage = this.buildTemplateMessage(fileCount);

    if (!this.commitMessageGenerator) {
      return templateMessage;
    }

    try {
      const diffSummary = await this.getStagedDiff();
      const aiMessage = await this.commitMessageGenerator.generate(
        files,
        diffSummary,
      );

      if (!aiMessage) {
        this.logger.warn(
          'AI commit message generation returned null; using template',
        );
        return templateMessage;
      }

      // For reversions: prefix with revert info + AI description
      if (this.pendingReversions.length > 0) {
        const { glob, commit } = this.pendingReversions[0];
        const shortCommit = commit.slice(0, 7);
        return `revert: ${glob} to ${shortCommit} — ${aiMessage}`;
      }

      return aiMessage;
    } catch (error) {
      this.logger.warn(
        { err: normalizeError(error) },
        'AI commit message generation failed; using template',
      );
      return templateMessage;
    }
  }

  /**
   * Commit a batch of files to the git repo with index.lock retry.
   */
  private async commitBatch(files: string[]): Promise<void> {
    if (files.length === 0) return;

    for (let attempt = 0; attempt <= MAX_LOCK_RETRIES; attempt++) {
      try {
        await execFileAsync('git', ['add', '--', ...files], {
          cwd: this.rootPath,
        });

        // Build message after staging so getStagedDiff can see the changes
        const message =
          attempt === 0
            ? await this.buildCommitMessage(files)
            : this.buildTemplateMessage(files.length);
        this.pendingReversions.length = 0;

        const { stdout } = await execFileAsync(
          'git',
          ['commit', '-m', message],
          { cwd: this.rootPath },
        );

        const hashMatch = /\[[\w-]+ ([a-f0-9]+)\]/.exec(stdout);
        const hash = hashMatch?.[1] ?? 'unknown';
        this.logger.info(
          { root: this.rootPath, hash, fileCount: files.length },
          'VCS commit created',
        );
        await this.pushIfConfigured();
        return;
      } catch (error) {
        if (isIndexLockError(error) && attempt < MAX_LOCK_RETRIES) {
          const delay = LOCK_RETRY_DELAYS[attempt];
          this.logger.warn(
            { root: this.rootPath, attempt: attempt + 1, delay },
            'index.lock contention, retrying',
          );
          await sleep(delay);
          continue;
        }

        this.logger.error(
          { root: this.rootPath, err: normalizeError(error) },
          'VCS commit failed',
        );
        return;
      }
    }
  }

  /**
   * Push to the configured remote if remoteUrl is set.
   * On failure: logs the error and records it in pushErrors; never throws.
   */
  private async pushIfConfigured(): Promise<void> {
    if (!this.remoteUrl) return;

    try {
      // Build the authenticated URL if a token is available
      const pushUrl = this.accessToken
        ? this.remoteUrl.replace(/^https:\/\//, `https://${this.accessToken}@`)
        : this.remoteUrl;

      await execFileAsync('git', ['push', pushUrl, 'HEAD'], {
        cwd: this.rootPath,
      });

      this._lastPushTime = new Date().toISOString();
      this.logger.info(
        { root: this.rootPath, remote: this.remoteUrl },
        'VCS push succeeded',
      );
    } catch (error) {
      const pushError: PushError = {
        timestamp: new Date().toISOString(),
        message: normalizeError(error).message,
      };
      this._pushErrors.push(pushError);
      this.logger.error(
        { root: this.rootPath, err: normalizeError(error) },
        'VCS push failed',
      );
    }
  }
}
