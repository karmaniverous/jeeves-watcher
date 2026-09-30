/**
 * @module test/vcsRepo
 * Shared fixtures for VcsManager commit-pipeline tests against real temp
 * git repos: config, git helpers, deterministic commit failure, polling,
 * and log-spy counting.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';

import { initRepo } from '../vcs/vcsBootstrap';
import { execFileAsync } from './git';

/** VcsConfig with test defaults (long throttle, 5-minute cooldown). */
export function makeVcsConfig(overrides: Partial<VcsConfig> = {}): VcsConfig {
  return {
    enabled: true,
    commitThrottleMs: 60000,
    maxBatchSize: 1000,
    staleLockThresholdMs: 600000,
    maxConsecutiveFailures: 5,
    circuitBreakerCooldownMs: 300000,
    branch: 'master',
    ...overrides,
  };
}

/**
 * VcsConfig for the VcsManager.*.test.ts fast-commit-pipeline suite: a
 * short throttle and stale-lock window keep those tests fast (they mostly
 * call `flush()` directly rather than waiting on timers).
 */
export function makeFastVcsConfig(
  overrides: Partial<VcsConfig> = {},
): VcsConfig {
  return makeVcsConfig({
    commitThrottleMs: 5000,
    staleLockThresholdMs: 60000,
    ...overrides,
  });
}

/** Run git in `cwd` and return stdout. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

/** Create a temp dir with an initialized repo and a local identity. */
export async function makeTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await initRepo(dir);
  await git(dir, 'config', 'user.email', 'test@test.com');
  await git(dir, 'config', 'user.name', 'Test');
  return dir;
}

/** Number of commits reachable from HEAD (0 for an empty repo). */
export async function commitCount(cwd: string): Promise<number> {
  try {
    return parseInt((await git(cwd, 'rev-list', '--count', 'HEAD')).trim(), 10);
  } catch {
    return 0;
  }
}

/** Stage everything and commit. */
export async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, 'add', '-A');
  await git(cwd, 'commit', '-m', message);
}

/**
 * Make every `git commit` fail deterministically (not an index.lock error):
 * require signing with a GPG program that doesn't exist.
 */
export async function breakCommits(cwd: string): Promise<void> {
  await git(cwd, 'config', 'commit.gpgSign', 'true');
  await git(cwd, 'config', 'gpg.program', 'jeeves-no-such-gpg-program');
}

/** Undo {@link breakCommits}. */
export async function fixCommits(cwd: string): Promise<void> {
  await git(cwd, 'config', 'commit.gpgSign', 'false');
}

/** Poll until `check` returns true or the timeout elapses. */
export async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('waitFor timed out');
}

/** The part of a vitest logger-method spy that assertions read. */
export interface LogSpy {
  mock: { calls: unknown[][] };
}

/** Count spy calls with any string argument containing `message`. */
export function countCalls(spy: LogSpy, message: string): number {
  return spy.mock.calls.filter((call) =>
    call.some((arg) => typeof arg === 'string' && arg.includes(message)),
  ).length;
}
