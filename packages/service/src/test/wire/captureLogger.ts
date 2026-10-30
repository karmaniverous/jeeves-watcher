/**
 * @module test/wire/captureLogger
 * A pino logger that keeps its `warn`-and-above records in memory, so tests can assert on what the server logged (e.g. no catalog response mismatches).
 */

import pino from 'pino';

/** One captured log record. */
export interface CapturedLog {
  /** Pino numeric level (40 warn, 50 error). */
  level: number;
  /** Log message. */
  msg: string;
  /** Remaining structured fields. */
  [key: string]: unknown;
}

/** A logger and the records it captured. */
export interface CaptureLogger {
  /** The logger to hand to the server. */
  logger: pino.Logger;
  /** Records captured so far, oldest first. */
  records: CapturedLog[];
}

/**
 * Prefix of the message core's catalog plugin logs for a response that
 * doesn't match its schema, in either mode (`'strict'` logs it as an error
 * and answers 500; `'log'` appends `(log mode)` and sends the response).
 */
export const RESPONSE_MISMATCH = 'Response validation failed';

/**
 * Create a logger that captures `warn` and above in memory.
 *
 * @returns The logger and its captured records.
 */
export function captureLogger(): CaptureLogger {
  const records: CapturedLog[] = [];
  const logger = pino(
    { level: 'warn' },
    {
      write: (line: string) => {
        records.push(JSON.parse(line) as CapturedLog);
      },
    },
  );
  return { logger, records };
}
