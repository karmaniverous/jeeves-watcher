/**
 * @module watcher/changeSource/restart
 * The process-restart seam of D196: on Windows the parcel source never unsubscribes (`@parcel/watcher` 2.6.0 crashes the process natively there), so a watcher rebuild or a subscription recovery exits the process for the service manager to restart it. The app implements the graceful restarter; `exitingRestarter` is the fallback for a watcher built without the app. I/O: `process.exit` in that fallback only.
 */

import type {
  ConfigWatchReindexScope,
  RestartCause,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { normalizeError } from '../../util/normalizeError';

/**
 * The exit code of an exit for a restart (D196): `EX_TEMPFAIL` from
 * `sysexits.h`, distinct from a clean stop (0) and a crash.
 */
export const RESTART_EXIT_CODE = 75;

export type { RestartCause };

/** One request to exit for a restart. */
export interface RestartRequest {
  /** The cause (a code, no path: it reaches health, D89). */
  cause: RestartCause;
  /** The root concerned, for the log line only. */
  root?: string;
  /** The error behind it, for the log line only. */
  err?: unknown;
  /**
   * A config reload's reindex scope (`configWatch.reindex`), run by the
   * restarted process instead of this one.
   */
  reindex?: ConfigWatchReindexScope;
}

/**
 * Exits the process for a service-manager restart (D196). `restart`
 * returns at once: the exit follows a graceful stop, so callers inside the
 * change source's queue never wait on themselves. Only the first request
 * of a process counts. Injected, so tests never call `process.exit`.
 */
export interface ProcessRestarter {
  /** Log the cause, stop gracefully, then exit with code 75 (`EX_TEMPFAIL`). */
  restart: (request: RestartRequest) => void;
}

/**
 * Whether parcel must never unsubscribe on this platform (D196): Windows,
 * where every in-process unsubscribe path crashed the P13 soak with
 * `0xC0000005`. Linux and macOS unsubscribe in-process.
 *
 * @param platform - `process.platform`.
 * @returns True on Windows.
 */
export function parcelNeverUnsubscribes(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

/**
 * The log line of an exit for a restart: the cause, the exit code and why
 * the process exits rather than resubscribing or rebuilding (D196).
 *
 * @param logger - Where it goes.
 * @param request - The request.
 */
export function logRestart(logger: pino.Logger, request: RestartRequest): void {
  const { cause, root, err } = request;
  logger.warn(
    {
      cause,
      exitCode: RESTART_EXIT_CODE,
      ...(root === undefined ? {} : { root }),
      ...(err === undefined ? {} : { err: normalizeError(err) }),
    },
    `Exiting for a service-manager restart (${cause}): @parcel/watcher cannot unsubscribe on Windows (D196)`,
  );
}

/**
 * A restarter for a watcher built without the app: it logs the cause and
 * exits at once, without a graceful stop. The app passes its own, which
 * stops gracefully first.
 *
 * @param logger - Where the cause is logged.
 * @param exit - `process.exit` (tests).
 * @returns The restarter.
 */
export function exitingRestarter(
  logger: pino.Logger,
  exit: (code: number) => void = (code) => process.exit(code),
): ProcessRestarter {
  let requested = false;
  return {
    restart: (request) => {
      if (requested) return;
      requested = true;
      logRestart(logger, request);
      exit(RESTART_EXIT_CODE);
    },
  };
}
