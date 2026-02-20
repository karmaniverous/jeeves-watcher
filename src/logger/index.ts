import pino from 'pino';

import type { LoggingConfig } from '../config/types';

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
    return pino({ level }, transport);
  }

  return pino({ level });
}
