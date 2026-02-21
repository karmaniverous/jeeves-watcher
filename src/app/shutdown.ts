/**
 * @module app/shutdown
 * Process signal shutdown orchestration. Installs SIGINT/SIGTERM handlers that invoke a provided async stop function.
 */

/**
 * Install process signal handlers.
 *
 * @param stop - Async stop function to invoke on shutdown signals.
 */
export function installShutdownHandlers(stop: () => Promise<void>): void {
  const shutdown = async () => {
    await stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}
