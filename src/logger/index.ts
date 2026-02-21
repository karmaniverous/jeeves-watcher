/**
 * @module logger
 * Creates pino logger instances. I/O: optionally writes logs to file via pino/file transport. Defaults to stdout at info level.
 */
import pino from 'pino';

import type { LoggingConfig } from '../config/types';

const serializers = {
  err: pino.stdSerializers.err,
  error: (err: unknown) => {
    if (err instanceof Error) {
      return {
        message: err.message,
        name: err.name,
        stack: err.stack,
        ...(err.cause ? { cause: err.cause } : {}),
      };
    }
    return { message: String(err), raw: err };
  },
};

/**
 * Create a pino logger instance.
 *
 * @param config - Optional logging configuration.
 * @returns A configured pino logger.
 */
export function createLogger(config?: LoggingConfig): pino.Logger {
  const level = config?.level ?? 'info';

  if (config?.file) {
    const transport = pino.transport({
      target: 'pino/file',
      options: { destination: config.file, mkdir: true },
    });
    return pino({ level, serializers }, transport);
  }

  return pino({ level, serializers });
}
