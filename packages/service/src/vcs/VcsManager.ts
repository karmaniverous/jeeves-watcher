/**
 * @module vcs/VcsManager
 * Per-root VCS manager for git-backed content versioning.
 */

import { execFile } from 'node:child_process';
import { access, appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';

const execFileAsync = promisify(execFile);

/** Always-on .gitignore entries for VCS-managed watch roots. */
const ALWAYS_GITIGNORE_ENTRIES = [
  '.git/',
  'node_modules/',
  '.jeeves-watcher/',
  '.jeeves-metadata/',
];

/**
 * Per-root VCS manager for git-backed content versioning.
 * Constructor takes the resolved VCS config for one watch root.
 */
export class VcsManager {
  readonly config: VcsConfig;

  constructor(config: VcsConfig) {
    this.config = config;
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
}
