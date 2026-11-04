/**
 * @module vcs/batchStaging
 * Stage one commit batch (D174, D175, D80): the batch tracked check splits it into tracked files (`add -u`), new files (`check-ignore`, then `add`), tracked deletions (`rm --cached`) and over-cap tracked files (returned for untracking). Runs git; stats files.
 *
 * A missing path never fails a batch, and neither does an ignored one:
 * `check-ignore` filters new files only, and tracked files under a folder
 * rule stage through `add -u`, which exits 0 where plain `add` exits 1.
 * Paths go to git root-relative with literal pathspecs (D116).
 */

import { stat } from 'node:fs/promises';
import { relative } from 'node:path';

import type pino from 'pino';

import { normalizeSlashes } from '../util/normalizeSlashes';
import { getErrorCode, normalizePathCase } from './gitExec';
import { gitAdd, gitAddUpdate, gitRmCached, listIgnored } from './gitIndex';
import type { OverCapWarnings } from './OverCapWarnings';
import { listTracked } from './trackedCheck';

/** On-disk state of one batch path. */
interface PathState {
  /** Root-relative path, forward slashes. */
  rel: string;
  /** Size in bytes, or undefined when the path does not exist. */
  size: number | undefined;
}

/** Errno codes that mean "this path does not exist". */
const MISSING_CODES: ReadonlySet<string | number> = new Set([
  'ENOENT',
  'ENOTDIR',
]);

/** Stat implementation (injectable for tests). */
export type StatFn = (path: string) => Promise<{ size: number }>;

/**
 * Stat a path. Only "does not exist" errors count as missing; any other
 * failure (permissions, I/O) propagates so the batch is retained and
 * retried rather than silently dropping a real change.
 *
 * @returns The size, or undefined when missing.
 */
async function sizeOf(
  path: string,
  statFn: StatFn,
): Promise<number | undefined> {
  try {
    return (await statFn(path)).size;
  } catch (error) {
    if (MISSING_CODES.has(getErrorCode(error) ?? '')) return undefined;
    throw error;
  }
}

/** A batch split for staging. */
export interface StagingPlan {
  /** Tracked and present (under the cap): `add -u`. */
  trackedPresent: string[];
  /** Present, not tracked, under the cap: `check-ignore`, then `add`. */
  newPaths: string[];
  /** Gone from disk and tracked: `rm --cached`. */
  missingTracked: string[];
  /** Tracked and over the cap: untracked by their own commit (D80). */
  overCapTracked: string[];
}

/** Options for {@link planStaging} and {@link stageBatch}. */
export interface StagingOptions {
  /** Size cap in bytes; `0` disables it (`vcs.maxFileBytes`, read per batch). */
  maxFileBytes: number;
  /** Once-per-path warnings for over-cap files (one per manager). */
  warnings: OverCapWarnings;
  /** Per-call timeout override for path-list calls (tests). */
  timeoutFor?: (paths: number) => number;
  /** Stat implementation (tests). */
  statFn?: StatFn;
}

/**
 * Split a batch by disk state, the batch tracked check and the size cap.
 * Missing untracked paths and over-cap new files are dropped.
 *
 * @param files - Absolute paths in the batch.
 * @param rootPath - Repository root.
 * @param logger - Logger (over-cap warnings, dropped counts).
 * @param options - Cap, warning registry, timeouts.
 * @returns The staging plan (root-relative paths).
 */
export async function planStaging(
  files: readonly string[],
  rootPath: string,
  logger: pino.Logger,
  options: StagingOptions,
): Promise<StagingPlan> {
  const statFn = options.statFn ?? stat;
  const states: PathState[] = await Promise.all(
    files.map(async (file) => ({
      rel: normalizeSlashes(relative(rootPath, file)),
      size: await sizeOf(file, statFn),
    })),
  );
  const tracked = new Set(
    (
      await listTracked(
        rootPath,
        states.map((s) => s.rel),
        options.timeoutFor ? { timeoutFor: options.timeoutFor } : {},
      )
    ).map((p) => normalizePathCase(p)),
  );

  const plan: StagingPlan = {
    trackedPresent: [],
    newPaths: [],
    missingTracked: [],
    overCapTracked: [],
  };
  let dropped = 0;
  for (const { rel, size } of states) {
    const isTracked = tracked.has(normalizePathCase(rel));
    if (size === undefined) {
      if (isTracked) plan.missingTracked.push(rel);
      else dropped++;
      continue;
    }
    if (options.maxFileBytes > 0 && size > options.maxFileBytes) {
      options.warnings.warn(rootPath, rel, size, isTracked, logger);
      if (isTracked) plan.overCapTracked.push(rel);
      else dropped++;
      continue;
    }
    options.warnings.clear(rel);
    (isTracked ? plan.trackedPresent : plan.newPaths).push(rel);
  }
  if (dropped > 0) {
    logger.debug(
      { root: rootPath, count: dropped },
      'Dropping missing or over-cap untracked paths from batch',
    );
  }
  return plan;
}

/**
 * Stage a batch: `add -u` for tracked files, `check-ignore` then `add` for
 * new files, then `rm --cached` for tracked deletions. Over-cap tracked
 * files are not staged; the caller untracks them (D80, D147).
 *
 * @param files - Absolute paths in the batch.
 * @param rootPath - Repository root.
 * @param logger - Logger.
 * @param options - Cap, warning registry, timeouts.
 * @returns Root-relative paths of tracked files over the cap.
 */
export async function stageBatch(
  files: readonly string[],
  rootPath: string,
  logger: pino.Logger,
  options: StagingOptions,
): Promise<string[]> {
  const plan = await planStaging(files, rootPath, logger, options);
  const callOptions = (count: number) =>
    options.timeoutFor ? { timeoutMs: options.timeoutFor(count) } : {};

  const ignored = new Set(
    (
      await listIgnored(
        rootPath,
        plan.newPaths,
        callOptions(plan.newPaths.length),
      )
    ).map((p) => normalizePathCase(p)),
  );
  const toAdd = plan.newPaths.filter((p) => !ignored.has(normalizePathCase(p)));

  await gitAddUpdate(
    rootPath,
    plan.trackedPresent,
    callOptions(plan.trackedPresent.length),
  );
  await gitAdd(rootPath, toAdd, callOptions(toAdd.length));
  await gitRmCached(
    rootPath,
    plan.missingTracked,
    callOptions(plan.missingTracked.length),
  );
  return plan.overCapTracked;
}
