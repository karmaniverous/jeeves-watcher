/**
 * @module app/shutdown
 * Process signal shutdown orchestration. Installs SIGINT/SIGTERM handlers that invoke a provided async stop function, and drains queues with a timeout.
 */

import type pino from 'pino';

/**
 * Wait for a queue to drain, giving up after `timeoutMs` with a warning.
 *
 * @param queue - Anything with a `drain()` promise (file or source queue).
 * @param timeoutMs - Maximum wait in milliseconds.
 * @param logger - Logger for the timeout warning.
 * @param label - Queue name used in the warning.
 * @returns `true` when drained, `false` on timeout.
 */
async function drainWithTimeout(
  queue: { drain: () => Promise<void> },
  timeoutMs: number,
  logger: pino.Logger | undefined,
  label: string,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const drained = await Promise.race<boolean>([
    queue.drain().then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (!drained) {
    logger?.warn(
      { timeoutMs, queue: label },
      `${label} drain timeout hit, forcing shutdown`,
    );
  }
  return drained;
}

/** Queues drained on shutdown. */
export interface ShutdownQueues {
  /** The file event queue. */
  queue?: { drain: () => Promise<void> };
  /** The source notify queue. */
  sourceQueue?: { drain: () => Promise<void>; stop: () => Promise<void> };
}

/**
 * Drain the file queue, then the source notify queue, each bounded by
 * `timeoutMs`; then stop the source queue so it refuses new work. The stop
 * is not awaited: after a timeout, in-flight runs must not block shutdown.
 *
 * @param queues - The queues (absent ones are skipped).
 * @param timeoutMs - Per-queue drain timeout in milliseconds.
 * @param logger - Logger for timeout warnings.
 */
export async function drainQueues(
  queues: ShutdownQueues,
  timeoutMs: number,
  logger: pino.Logger | undefined,
): Promise<void> {
  if (queues.queue) {
    await drainWithTimeout(queues.queue, timeoutMs, logger, 'Queue');
  }
  if (queues.sourceQueue) {
    const { sourceQueue } = queues;
    await drainWithTimeout(sourceQueue, timeoutMs, logger, 'Source queue');
    void sourceQueue.stop();
  }
}

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
