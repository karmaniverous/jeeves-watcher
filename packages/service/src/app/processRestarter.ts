/**
 * @module app/processRestarter
 * The app's exit for a service-manager restart (D196): log the cause, leave a restart record in the state directory, stop gracefully, then exit with `RESTART_EXIT_CODE`; at the next start, take the record and report it in `health.changeSource` (the app runs any deferred config reindex). I/O: the record file, `process.exit`.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  reindexScopeSchema,
  restartCauseSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';
import { z } from 'zod';

import { normalizeError } from '../util/normalizeError';
import {
  logRestart,
  type ProcessRestarter,
  RESTART_EXIT_CODE,
} from '../watcher/changeSource/restart';
import type { ChangeSourceHealthTracker } from '../watcher/ChangeSourceHealthTracker';

/** The restart record's file name under the state directory. */
export const RESTART_RECORD_FILE = 'restart.json';

/** What an exit for a restart leaves for the next process. */
const restartRecordSchema = z.object({
  cause: restartCauseSchema,
  at: z.string(),
  reindex: reindexScopeSchema.optional(),
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
  /** `process.exit` (tests). */
  exit?: (code: number) => void;
  /** The clock (tests). */
  now?: () => Date;
}

/**
 * The app's restarter: only the first request counts; `restart` returns at
 * once and the exit follows the graceful stop (whose steps are bounded by
 * `shutdownTimeoutMs`), even when the stop fails.
 *
 * @param deps - State dir, logger, stop, exit.
 * @returns The restarter.
 */
export function createProcessRestarter(
  deps: ProcessRestarterDeps,
): ProcessRestarter {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const now = deps.now ?? (() => new Date());
  let requested = false;
  return {
    restart: (request) => {
      if (requested) return;
      requested = true;
      const logger = deps.logger();
      if (logger) logRestart(logger, request);
      const record: RestartRecord = {
        cause: request.cause,
        at: now().toISOString(),
        ...(request.reindex === undefined ? {} : { reindex: request.reindex }),
      };
      try {
        mkdirSync(deps.stateDir, { recursive: true });
        writeFileSync(
          join(deps.stateDir, RESTART_RECORD_FILE),
          JSON.stringify(record),
        );
      } catch (error) {
        logger?.error(
          { err: normalizeError(error) },
          'Could not write the restart record',
        );
      }
      void deps
        .stop()
        .catch((error: unknown) => {
          logger?.error(
            { err: normalizeError(error) },
            'Graceful stop before the restart failed',
          );
        })
        .finally(() => {
          exit(RESTART_EXIT_CODE);
        });
    },
  };
}

/**
 * Read and remove the record an exit for a restart left (D196), so it is
 * reported once, by the process that started after it. A missing file is
 * the normal case; an unreadable one is logged and removed.
 *
 * @param stateDir - The state directory.
 * @param logger - Where an unreadable record is reported.
 * @returns The record, or undefined.
 */
export function takeRestartRecord(
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
  rmSync(path, { force: true });
  try {
    return restartRecordSchema.parse(JSON.parse(text));
  } catch (error) {
    logger.warn(
      { err: normalizeError(error) },
      'Ignored an unreadable restart record',
    );
    return undefined;
  }
}

/**
 * At start: take the record an exit for a restart left (D196), log it and
 * report its cause in `health.changeSource`.
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
  const restart = takeRestartRecord(stateDir, logger);
  if (restart) {
    health.recordRestart(restart);
    logger.info(
      { cause: restart.cause, at: restart.at, reindex: restart.reindex },
      'Started after an exit for a restart (D196)',
    );
  }
  return restart;
}
