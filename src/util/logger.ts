/**
 * @module util/logger
 * Logger fallback helper. Provides a unified warn interface that delegates to pino or console.
 */

import type pino from 'pino';

/**
 * A minimal logger interface supporting warn-level messages.
 */
export interface MinimalLogger {
  warn(obj: unknown, msg?: string): void;
}

/**
 * Return a minimal logger that delegates to pino if available, otherwise console.
 *
 * @param logger - Optional pino logger instance.
 * @returns A minimal logger.
 */
export function getLogger(logger?: pino.Logger): MinimalLogger {
  if (logger) return logger;
  return {
    warn(obj: unknown, msg?: string) {
      if (msg) {
        console.warn(obj, msg);
      } else {
        console.warn(obj);
      }
    },
  };
}
