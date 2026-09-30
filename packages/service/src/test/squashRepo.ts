/**
 * @module test/squashRepo
 * Shared fixtures for SquashManager tests: retention config, dated commits,
 * and a squashable history in a real temp repo.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { VcsRetentionConfig } from '@karmaniverous/jeeves-watcher-core';

import { execFileAsync } from './git';

const DAY_MS = 86_400_000;

/** Retention config with test defaults (30 days, 100 versions). */
export function makeRetention(
  overrides: Partial<VcsRetentionConfig> = {},
): VcsRetentionConfig {
  return {
    maxAgeDays: 30,
    maxVersions: 100,
    squashCron: '0 0 * * *',
    ...overrides,
  };
}

/** Number of commits reachable from HEAD (0 for an empty repo). */
export async function commitCount(cwd: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', 'HEAD'],
      { cwd },
    );
    return parseInt(stdout.trim(), 10);
  } catch {
    return 0;
  }
}

/** `git init` plus a local identity. */
export async function initTestRepo(cwd: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], {
    cwd,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd });
}

/** ISO timestamp `days` days before now. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/**
 * Write a file, stage it, and commit it (optionally backdated).
 *
 * @returns The full hash of the new commit.
 */
export async function createCommit(
  cwd: string,
  filename: string,
  content: string,
  dateIso?: string,
): Promise<string> {
  await writeFile(join(cwd, filename), content, 'utf8');
  await execFileAsync('git', ['add', filename], { cwd });

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (dateIso) {
    env['GIT_AUTHOR_DATE'] = dateIso;
    env['GIT_COMMITTER_DATE'] = dateIso;
  }
  await execFileAsync('git', ['commit', '-m', `add ${filename}`], {
    cwd,
    env,
  });

  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd,
  });
  return stdout.trim();
}

/**
 * Two commits older than the default 30-day retention and one recent
 * commit: a default squash removes 2 and keeps 1 (plus the baseline).
 */
export async function createSquashableHistory(cwd: string): Promise<void> {
  await createCommit(cwd, 'file1.txt', 'a', daysAgo(60));
  await createCommit(cwd, 'file2.txt', 'b', daysAgo(50));
  await createCommit(cwd, 'file3.txt', 'c', daysAgo(1));
}
