/**
 * @module vcs/excludePattern
 * `POST /vcs/exclude`'s git work, in one RootGitLock hold waited for at most 30 s (D102): add a root-anchored pattern to `.git/info/exclude` and untrack the files it matches through the shared untrack helper (D71, D164), then push; or remove a pattern. Runs git; writes `.git/info/exclude`.
 *
 * Adding refuses (writing nothing) when more than
 * `VCS_EXCLUDE_CONFIRM_THRESHOLD` files would be untracked without
 * `confirm` (D103). A failure before the untrack commit is published removes
 * the line this call appended; after publication, the `untrack.pending`
 * marker finishes the work at the next batch or start (D178).
 */

import { stat } from 'node:fs/promises';

import { VCS_EXCLUDE_CONFIRM_THRESHOLD } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import {
  addExcludeLine,
  excludeFilePath,
  removeExcludeLine,
} from './excludeFile';
import { removeLegacyGitignoreLine } from './legacyGitignore';
import { ROUTE_LOCK_WAIT_MS } from './RootGitLock';
import { runGit } from './runGit';
import { type UntrackHooks, untrackPaths } from './untrack';
import { recoverUntrackPending, untrackMarkerPath } from './untrackPending';
import type { VcsManager } from './VcsManager';

/** Thrown when adding would untrack too many files without `confirm`. */
export class ConfirmRequiredError extends Error {
  /**
   * @param pattern - The pattern.
   * @param untracked - How many files it would untrack.
   */
  constructor(
    readonly pattern: string,
    readonly untracked: number,
  ) {
    super(
      `Excluding ${pattern} would untrack ${String(untracked)} files; repeat with confirm: true`,
    );
    this.name = 'ConfirmRequiredError';
  }
}

/** One exclude request, already resolved to its root. */
export interface ExcludeRequest {
  /** Root-anchored pattern (`/` + root-relative glob). */
  pattern: string;
  /** Root-relative glob without the leading `/` (0.20.0's form). */
  relativeGlob: string;
  /** Remove the pattern instead of adding it. */
  remove: boolean;
  /** Allow untracking more than the threshold. */
  confirm: boolean;
  /** Untrack test hooks. */
  hooks?: UntrackHooks;
}

/** What an exclude did. */
export interface ExcludeOutcome {
  /** The file written (forward slashes). */
  file: string;
  /** Whether the pattern was added or removed. */
  action: 'added' | 'removed';
  /** Paths removed from the real index. */
  untracked: number;
}

/** The untrack commit's message. */
function untrackMessage(count: number, pattern: string): string {
  return `Untrack ${String(count)} file${count === 1 ? '' : 's'} matching ${pattern}`;
}

/**
 * Tracked paths an index holds that `pattern` matches, with gitignore glob
 * semantics (`ls-files -c -i -x`, never `--exclude-standard`: only this
 * pattern counts, D71, D116).
 */
async function listMatches(
  root: string,
  pattern: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const { stdout } = await runGit(
    root,
    ['ls-files', '-z', '-c', '-i', '-x', pattern],
    { env },
  );
  return stdout.split('\0').filter((p) => p.length > 0);
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Add the pattern and untrack what it matches (the lock is held). */
async function addPattern(
  manager: VcsManager,
  request: ExcludeRequest,
  logger: pino.Logger,
): Promise<ExcludeOutcome> {
  const root = manager.rootPath;
  const { pattern } = request;
  // An object, so the check after the callback is not narrowed to false.
  const line = { appended: false };
  try {
    const { commit, untracked } = await untrackPaths(root, {
      select: (env) => listMatches(root, pattern, env),
      message: (count) => untrackMessage(count, pattern),
      pattern,
      ...(request.hooks ? { hooks: request.hooks } : {}),
      beforeWrite: async (count) => {
        if (count > VCS_EXCLUDE_CONFIRM_THRESHOLD && !request.confirm) {
          throw new ConfirmRequiredError(pattern, count);
        }
        line.appended = await addExcludeLine(root, pattern);
      },
    });
    if (commit !== undefined) await manager.pushInHold();
    logger.info(
      { root, pattern, commit, untracked: untracked.length },
      'VCS exclude added',
    );
    return {
      file: excludeFilePath(root),
      action: 'added',
      untracked: untracked.length,
    };
  } catch (error) {
    if (line.appended && !(await exists(untrackMarkerPath(root)))) {
      await removeExcludeLine(root, pattern);
    }
    throw error;
  }
}

/** Remove the pattern: `.git/info/exclude` first, then 0.20.0's `.gitignore`. */
async function removePattern(
  root: string,
  request: ExcludeRequest,
): Promise<ExcludeOutcome> {
  const file = (await removeExcludeLine(root, request.pattern))
    ? excludeFilePath(root)
    : await removeLegacyGitignoreLine(root, request.relativeGlob);
  return { file, action: 'removed', untracked: 0 };
}

/**
 * Run an exclude on a root under its RootGitLock, waiting at most `waitMs`
 * (D102). A leftover `untrack.pending` marker is finished or discarded
 * first, so this call's marker never replaces it.
 *
 * @param manager - The root's VCS manager.
 * @param request - The resolved request.
 * @param logger - Logger.
 * @param waitMs - Longest wait for the lock (default 30 s).
 * @returns What was done.
 * @throws LockWaitTimeoutError when the lock is busy past `waitMs`;
 *   ConfirmRequiredError; LegacyPatternNotFoundError for a pattern to
 *   remove that is nowhere.
 */
export function runExclude(
  manager: VcsManager,
  request: ExcludeRequest,
  logger: pino.Logger,
  waitMs = ROUTE_LOCK_WAIT_MS,
): Promise<ExcludeOutcome> {
  return manager.lock.runWithin('exclude', waitMs, async () => {
    await recoverUntrackPending(manager.rootPath, logger);
    return request.remove
      ? removePattern(manager.rootPath, request)
      : addPattern(manager, request, logger);
  });
}
