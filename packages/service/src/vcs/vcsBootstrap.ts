/**
 * @module vcs/vcsBootstrap
 * Static bootstrap utilities for VCS-managed watch roots.
 */

import { access, appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { execFileAsync } from './gitExec';

/** Always-on .gitignore entries for VCS-managed watch roots. */
export const ALWAYS_GITIGNORE_ENTRIES = [
  '.git/',
  'node_modules/',
  '.jeeves-watcher/',
  '.jeeves-metadata/',
];

/**
 * Check whether git is available on the system PATH.
 *
 * @returns true if git is available, false otherwise.
 */
export async function checkGitAvailable(): Promise<boolean> {
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
export async function initRepo(rootPath: string): Promise<void> {
  const gitDir = join(rootPath, '.git');
  try {
    await access(gitDir);
    // .git exists, nothing to do
  } catch {
    await execFileAsync('git', ['init'], { cwd: rootPath });
  }
}

/**
 * Configure local git identity for a repository.
 * Sets repo-level (not global) user.name and user.email.
 *
 * @param rootPath - Directory of the git repository.
 * @param name - Author name for commits.
 * @param email - Author email for commits.
 */
export async function configureRepoIdentity(
  rootPath: string,
  name: string,
  email: string,
): Promise<void> {
  await execFileAsync('git', ['config', '--local', 'user.name', name], {
    cwd: rootPath,
  });
  await execFileAsync('git', ['config', '--local', 'user.email', email], {
    cwd: rootPath,
  });
}

/**
 * Ensure a .gitignore file exists at rootPath with all always-on entries.
 * Creates the file if missing. Appends only entries not already present.
 *
 * @param rootPath - Directory containing the .gitignore.
 * @param alwaysOnEntries - Additional always-on entries beyond the defaults.
 */
export async function ensureGitignore(
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
  const missing = requiredEntries.filter((entry) => !existingLines.has(entry));

  if (missing.length === 0) return;

  if (existingContent.length === 0) {
    await writeFile(gitignorePath, missing.join('\n') + '\n', 'utf8');
  } else {
    const prefix = existingContent.endsWith('\n') ? '' : '\n';
    await appendFile(gitignorePath, prefix + missing.join('\n') + '\n', 'utf8');
  }
}
