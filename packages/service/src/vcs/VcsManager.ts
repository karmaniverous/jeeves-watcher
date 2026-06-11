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

/**
 * Per-root VCS manager for git-backed content versioning.
 * Constructor takes the resolved VCS config for one watch root.
 */
export class VcsManager {
  readonly config: VcsConfig;
  readonly rootPath: string;
  private readonly logger: pino.Logger;
  private readonly pending: Set<string> = new Set();
  private readonly pendingReversions: PendingReversion[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private commitInFlight: Promise<void> = Promise.resolve();
  private started = false;

  constructor(rootPath: string, config: VcsConfig, logger: pino.Logger) {
    this.rootPath = rootPath;
    this.config = config;
    this.logger = logger;
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
   * Build the commit message, using reversion metadata when available.
   */
  private buildCommitMessage(fileCount: number): string {
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
   * Commit a batch of files to the git repo with index.lock retry.
   */
  private async commitBatch(files: string[]): Promise<void> {
    if (files.length === 0) return;

    const message = this.buildCommitMessage(files.length);
    this.pendingReversions.length = 0;

    for (let attempt = 0; attempt <= MAX_LOCK_RETRIES; attempt++) {
      try {
        await execFileAsync('git', ['add', '--', ...files], {
          cwd: this.rootPath,
        });

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
}
