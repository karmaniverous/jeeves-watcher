/**
 * @module logger
 * Creates pino loggers. I/O: with `logging.file`, writes through pino-roll (rotation by size and schedule, oldest files pruned) or a plain pino destination when rotation is off, opened before the logger is returned (D171). Defaults to stdout at info level.
 *
 * The file destination runs on the main thread (no worker transport), so
 * {@link logRefusal} can flush it synchronously before the process exits.
 */
import { once } from 'node:events';

import {
  LOGGING_ROTATION_DEFAULTS,
  type LogRotationConfig,
  parseByteSize,
} from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import pinoRoll, { type PinoRollOptions, type RollStream } from 'pino-roll';

import type { LoggingConfig } from '../config/types';
import { normalizeError } from '../util/normalizeError';

/** File destinations by logger, for synchronous flushing. */
const destinations = new WeakMap<pino.Logger, RollStream>();

/**
 * pino-roll options for a log file (D171). Sizes go as `<bytes>b`, since
 * pino-roll reads a bare number as megabytes.
 *
 * @param file - The configured `logging.file`.
 * @param rotation - `logging.rotation` (each key falls back to its default).
 * @returns Options for pino-roll.
 */
export function rollOptions(
  file: string,
  rotation: LogRotationConfig = {},
): PinoRollOptions {
  const maxSize = rotation.maxSize ?? LOGGING_ROTATION_DEFAULTS.maxSize;
  return {
    file,
    size: `${String(parseByteSize(maxSize))}b`,
    frequency: rotation.frequency ?? LOGGING_ROTATION_DEFAULTS.frequency,
    dateFormat: 'yyyy-MM-dd',
    // pino-roll keeps `count` rotated files in addition to the active one, so
    // maxFiles: N leaves up to N + 1 files (D184, amending D93/D159).
    limit: {
      count: rotation.maxFiles ?? LOGGING_ROTATION_DEFAULTS.maxFiles,
      removeOtherLogFiles: true,
    },
    symlink: false,
    mkdir: true,
  };
}

/** Wait until a destination has opened its file. */
async function opened(stream: RollStream): Promise<void> {
  if ((stream.fd ?? -1) >= 0) return;
  await once(stream, 'ready');
}

/**
 * Create a pino logger. With `logging.file`, the file is open (or the
 * call rejects) before the logger is returned, so no early line is lost.
 *
 * @param config - Optional logging configuration.
 * @returns A configured pino logger.
 */
export async function createLogger(
  config?: LoggingConfig,
): Promise<pino.Logger> {
  const level = config?.level ?? 'info';
  if (!config?.file) return pino({ level });

  const stream: RollStream =
    config.rotation === false
      ? pino.destination({ dest: config.file, mkdir: true })
      : await pinoRoll(rollOptions(config.file, config.rotation));
  await opened(stream);
  // A roll, prune or write failure (ENOSPC) must not crash the service.
  stream.on('error', (error: unknown) => {
    process.stderr.write(`Log file error: ${normalizeError(error).message}\n`);
  });
  const logger = pino({ level }, stream);
  destinations.set(logger, stream);
  return logger;
}

/**
 * Flush a file logger's destination synchronously (before `process.exit`,
 * which pino-roll's stream does not hook). A destination not open yet, or
 * already closed, is skipped.
 *
 * @param logger - The service logger.
 */
export function flushLogger(logger: pino.Logger): void {
  try {
    destinations.get(logger)?.flushSync();
  } catch {
    // Not open yet, or already closed.
  }
}

/**
 * Record a refusal or fatal exit where it cannot be lost (D171): a fatal
 * log line, a synchronous flush of the file destination (in a try/catch,
 * since an unopened destination throws), then the same message on stderr.
 *
 * @param logger - The service logger.
 * @param message - What was refused, and why.
 * @param error - The underlying error, if any.
 */
export function logRefusal(
  logger: pino.Logger,
  message: string,
  error?: unknown,
): void {
  const err = error === undefined ? undefined : normalizeError(error);
  logger.fatal(err ? { err } : {}, message);
  flushLogger(logger);
  process.stderr.write(`${message}${err ? `: ${err.message}` : ''}\n`);
}
