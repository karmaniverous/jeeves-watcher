/**
 * @module app/processRestarter
 * The app's exit for a service-manager restart (D196): log the cause, leave a restart record in the state directory, stop gracefully (with a hard deadline), then exit with `RESTART_EXIT_CODE`; at the next start, read the record, report it in `health.changeSource` (the app runs any deferred config reindex) and clear it once the start succeeded. I/O: the record file, a timer, `process.exit`.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  configWatchReindexScopeSchema,
  restartCauseSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';
import { z } from 'zod';

import type { ReindexDepsSource } from '../api/executeReindex';
import { normalizeError } from '../util/normalizeError';
import {
  logRestart,
  type ProcessRestarter,
  RESTART_EXIT_CODE,
} from '../watcher/changeSource/restart';
import type { ChangeSourceHealthTracker } from '../watcher/ChangeSourceHealthTracker';
import { runConfigReindex } from './configReload';

/** The restart record's file name under the state directory. */
export const RESTART_RECORD_FILE = 'restart.json';

/** What an exit for a restart leaves for the next process. */
const restartRecordSchema = z.object({
  cause: restartCauseSchema,
  at: z.string(),
  reindex: configWatchReindexScopeSchema.optional(),
});

/** The restart record (D196). */
export type RestartRecord = z.infer<typeof restartRecordSchema>;

/** What {@link createProcessRestarter} needs from the app. */
export interface ProcessRestarterDeps {
  /** The state directory (the record goes there). */
  stateDir: string;
  /** The app's logger, once it exists. */
  logger: () => pino.Logger | undefined;
  /** The app's graceful stop. */
  stop: () => Promise<void>;
  /**
   * The longest the graceful stop may take before the process exits
   * anyway: some stop steps (a hung `lstat` or git call) have no timeout.
   */
  deadlineMs: number;
  /** `process.exit` (tests). */
  exit?: (code: number) => void;
  /** The clock (tests). */
  now?: () => Date;
}

/**
 * The app's restarter. Only the first request exits; a later request that
 * carries a deferred reindex adds it to the record. `restart` returns at
 * once; the exit follows the graceful stop, or `deadlineMs`, whichever is
 * first, also when the stop fails.
 *
 * @param deps - State dir, logger, stop, deadline, exit.
 * @returns The restarter.
 */
export function createProcessRestarter(
  deps: ProcessRestarterDeps,
): ProcessRestarter {
  const exitOnce = once(deps.exit ?? ((code: number) => process.exit(code)));
  const now = deps.now ?? (() => new Date());
  let record: RestartRecord | undefined;
  const write = () => {
    try {
      mkdirSync(deps.stateDir, { recursive: true });
      writeFileSync(
        join(deps.stateDir, RESTART_RECORD_FILE),
        JSON.stringify(record),
      );
    } catch (error) {
      deps
        .logger()
        ?.error(
          { err: normalizeError(error) },
          'Could not write the restart record',
        );
    }
  };
  return {
    restart: (request) => {
      if (record) {
        if (request.reindex !== undefined && record.reindex === undefined) {
          record.reindex = request.reindex;
          write();
        }
        return;
      }
      const logger = deps.logger();
      if (logger) logRestart(logger, request);
      record = {
        cause: request.cause,
        at: now().toISOString(),
        ...(request.reindex === undefined ? {} : { reindex: request.reindex }),
      };
      write();
      const deadline = setTimeout(() => {
        logger?.error(
          { deadlineMs: deps.deadlineMs },
          'Graceful stop before the restart did not finish in time; exiting',
        );
        exitOnce(RESTART_EXIT_CODE);
      }, deps.deadlineMs);
      deadline.unref();
      void deps
        .stop()
        .catch((error: unknown) => {
          logger?.error(
            { err: normalizeError(error) },
            'Graceful stop before the restart failed',
          );
        })
        .finally(() => {
          clearTimeout(deadline);
          exitOnce(RESTART_EXIT_CODE);
        });
    },
  };
}

/** Wrap `exit` so only its first call goes through. */
function once(exit: (code: number) => void): (code: number) => void {
  let done = false;
  return (code) => {
    if (done) return;
    done = true;
    exit(code);
  };
}

/**
 * Read the record an exit for a restart left (D196). A missing file is the
 * normal case; an unreadable one is logged and removed.
 *
 * @param stateDir - The state directory.
 * @param logger - Where an unreadable record is reported.
 * @returns The record, or undefined.
 */
export function readRestartRecord(
  stateDir: string,
  logger: pino.Logger,
): RestartRecord | undefined {
  const path = join(stateDir, RESTART_RECORD_FILE);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return restartRecordSchema.parse(JSON.parse(text));
  } catch (error) {
    rmSync(path, { force: true });
    logger.warn(
      { err: normalizeError(error) },
      'Ignored an unreadable restart record',
    );
    return undefined;
  }
}

/**
 * Remove the record once the start it was read by succeeded, so a refused
 * start keeps it for the next one. A newer record (this process already
 * asked for another restart) is kept.
 *
 * @param stateDir - The state directory.
 * @param taken - The record the start read.
 */
export function clearRestartRecord(
  stateDir: string,
  taken: RestartRecord,
): void {
  const path = join(stateDir, RESTART_RECORD_FILE);
  try {
    const current = JSON.parse(readFileSync(path, 'utf8')) as RestartRecord;
    if (current.at !== taken.at || current.cause !== taken.cause) return;
  } catch {
    return;
  }
  rmSync(path, { force: true });
}

/**
 * At start: read the record an exit for a restart left (D196), log it and
 * report its cause in `health.changeSource`. The caller clears it with
 * {@link clearRestartRecord} once the start succeeded.
 *
 * @param stateDir - The state directory.
 * @param logger - Where it is logged.
 * @param health - The app's change-source health.
 * @returns The record (its `reindex` is the caller's to run), or undefined.
 */
export function resumeAfterRestart(
  stateDir: string,
  logger: pino.Logger,
  health: Pick<ChangeSourceHealthTracker, 'recordRestart'>,
): RestartRecord | undefined {
  const restart = readRestartRecord(stateDir, logger);
  if (restart) {
    health.recordRestart(restart);
    logger.info(
      { cause: restart.cause, at: restart.at, reindex: restart.reindex },
      'Started after an exit for a restart (D196)',
    );
  }
  return restart;
}

/**
 * After a start that read a restart record succeeded: clear the record and
 * run the config reindex the reload deferred to this restart, in the
 * background like the reload would have (a failure is logged).
 *
 * @param stateDir - The state directory.
 * @param restart - The record the start read.
 * @param deps - Live config, processor, logger and stores for the reindex.
 */
export function completeRestart(
  stateDir: string,
  restart: RestartRecord,
  deps: ReindexDepsSource,
): void {
  clearRestartRecord(stateDir, restart);
  if (restart.reindex === undefined) return;
  runConfigReindex(deps, restart.reindex).catch((error: unknown) => {
    deps.logger.error(
      { err: normalizeError(error), scope: restart.reindex },
      'Config reindex deferred to the restart failed',
    );
  });
}
