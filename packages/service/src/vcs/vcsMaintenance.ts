/**
 * @module vcs/vcsMaintenance
 * Per-root VCS maintenance run under RootGitLock: the startup pass (stale `index.lock`, temp-file sweep, `untrack.pending` recovery, branch and in-progress warnings) and the hourly temp-file sweep. Never moves a branch or checks one out (D167).
 */

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import {
  detectStaleGitOperation,
  removeStaleIndexLock,
  STALE_OPERATION_HINT,
} from './gitRepoState';
import type { RootGitLock } from './RootGitLock';
import { runGit } from './runGit';
import { sweepTempFiles } from './tempFiles';
import { recoverUntrackPending } from './untrackPending';

/** Interval of the scheduled temp-file sweep. */
export const SWEEP_INTERVAL_MS = 60 * 60_000;

/** Prefix of the branches 0.20.0's squash created. */
const ORPHAN_PREFIX = '__squash_orphan_';

/**
 * Warn when HEAD is not on the configured branch, or a leftover
 * `__squash_orphan_*` branch exists (D167). Changes nothing.
 *
 * @param root - Repository root.
 * @param branch - The configured `vcs.branch`.
 * @param logger - Logger.
 */
export async function warnBranchState(
  root: string,
  branch: string,
  logger: pino.Logger,
): Promise<void> {
  const head = await runGit(root, ['symbolic-ref', '-q', '--short', 'HEAD'])
    .then(({ stdout }) => stdout.trim())
    .catch(() => '(detached)');
  const orphans = (
    await runGit(root, [
      'for-each-ref',
      '--format=%(refname:short)',
      `refs/heads/${ORPHAN_PREFIX}*`,
    ])
  ).stdout
    .split('\n')
    .filter((name) => name.length > 0);
  if (head === branch && orphans.length === 0) return;
  logger.warn(
    { root, head, expectedBranch: branch, orphanBranches: orphans },
    `VCS root is not in its expected branch state — the watcher never switches branches; check the root, then 'git checkout ${branch}' and delete any leftover ${ORPHAN_PREFIX}* branch by hand. Squash refuses until HEAD is on ${branch}.`,
  );
}

/** Run one maintenance step, logging (never throwing) its failure. */
async function step(
  label: string,
  root: string,
  logger: pino.Logger,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    logger.warn({ root, err: normalizeError(error) }, `${label} failed`);
  }
}

/**
 * The startup pass for one root (caller holds its RootGitLock).
 *
 * @param root - Repository root.
 * @param config - The root's VCS config.
 * @param logger - Logger.
 */
export async function runStartupMaintenance(
  root: string,
  config: VcsConfig,
  logger: pino.Logger,
): Promise<void> {
  await removeStaleIndexLock(root, config.staleLockThresholdMs, logger);
  await step('Temp-file sweep', root, logger, () => sweepTempFiles(root));
  await step('untrack.pending recovery', root, logger, () =>
    recoverUntrackPending(root, logger),
  );
  await step('Branch check', root, logger, () =>
    warnBranchState(root, config.branch, logger),
  );
  const marker = await detectStaleGitOperation(root);
  if (marker !== undefined) {
    logger.error(
      { root, marker },
      `Stale in-progress git operation detected (.git/${marker}) — squash retention will refuse to run until you ${STALE_OPERATION_HINT}`,
    );
  }
}

/**
 * Sweep temp files hourly under the lock.
 *
 * @param root - Repository root.
 * @param lock - The root's lock.
 * @param logger - Logger.
 * @param intervalMs - Interval (tests).
 * @returns The interval timer (clear it on stop).
 */
export function sweepOnSchedule(
  root: string,
  lock: RootGitLock,
  logger: pino.Logger,
  intervalMs: number = SWEEP_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    void lock.run('sweep', () =>
      step('Temp-file sweep', root, logger, () => sweepTempFiles(root)),
    );
  }, intervalMs);
  timer.unref();
  return timer;
}
