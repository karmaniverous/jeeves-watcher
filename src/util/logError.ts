/**
 * @module util/logError
 * Utility to centralize error logging with normalized error objects.
 */

import type pino from 'pino';

import { normalizeError } from './normalizeError';

/**
 * Log an error with normalized error object and additional context.
 *
 * Reduces the repeated pattern of `{ err: normalizeError(error), ...context }` + `logger.error()`.
 *
 * @param logger - Pino logger instance.
 * @param error - The error to log (will be normalized).
 * @param message - Log message.
 * @param context - Additional context fields to include in the log entry.
 */
export function logError(
  logger: pino.Logger,
  error: unknown,
  message: string,
  context: Record<string, unknown> = {},
): void {
  logger.error({ ...context, err: normalizeError(error) }, message);
}
