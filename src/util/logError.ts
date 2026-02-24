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
  context: Record<string, unknown>,
  message: string,
): void;
export function logError(
  logger: pino.Logger,
  error: unknown,
  message: string,
  context?: Record<string, unknown>,
): void;
export function logError(
  logger: pino.Logger,
  error: unknown,
  a: string | Record<string, unknown>,
  b?: string | Record<string, unknown>,
): void {
  if (typeof a === 'string') {
    const message = a;
    const context = (b ?? {}) as Record<string, unknown>;
    logger.error({ ...context, err: normalizeError(error) }, message);
    return;
  }

  const context = a;
  const message = typeof b === 'string' ? b : '';
  logger.error({ ...context, err: normalizeError(error) }, message);
}
