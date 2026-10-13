/**
 * @module app/shutdown
 * Shutdown orchestration: closes the API server first (no new notifies), stops producers, drains and stops queues with timeouts, and closes stores only when no abandoned run is still in flight. Installs SIGINT/SIGTERM handlers.
 */

import type pino from 'pino';

/**
 * Wait for a promise, giving up after `timeoutMs`.
 *
 * @param promise - The work to wait for (its rejection counts as settled).
 * @param timeoutMs - Maximum wait in milliseconds.
 * @returns `true` when settled in time, `false` on timeout.
 */
export async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const settled = await Promise.race<boolean>([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return settled;
}

/**
 * Wait for a step, warning when it times out.
 *
 * @returns `true` when the step settled in time.
 */
async function step(
  label: string,
  work: Promise<unknown>,
  timeoutMs: number,
  logger: pino.Logger | undefined,
): Promise<boolean> {
  const done = await settlesWithin(work, timeoutMs);
  if (!done) {
    logger?.warn(
      { timeoutMs, step: label },
      `${label} timeout hit, forcing shutdown`,
    );
  }
  return done;
}

/** A queue drained and stopped on shutdown. */
export interface StoppableQueue {
  /** Resolve once the queue holds no work. */
  drain: () => Promise<void>;
  /** Drop remaining work, refuse new work, resolve once in-flight work ends. */
  stop: () => Promise<void>;
}

/** Queues drained on shutdown. */
export interface ShutdownQueues {
  /** The file event queue. */
  queue?: StoppableQueue;
  /** The source notify queue. */
  sourceQueue?: StoppableQueue;
}

/**
 * Drain a queue, then stop it (whatever the drain did); each step bounded.
 *
 * @returns `true` when the stop finished, i.e. no run is still in flight.
 */
async function drainThenStop(
  label: string,
  queue: StoppableQueue,
  timeoutMs: number,
  logger: pino.Logger | undefined,
): Promise<boolean> {
  await step(`${label} drain`, queue.drain(), timeoutMs, logger);
  return step(`${label} stop`, queue.stop(), timeoutMs, logger);
}

/**
 * Drain and stop the file queue, then the source notify queue. Stopping
 * drops work the drain did not reach, refuses new work and waits for
 * in-flight runs; each step is bounded by `timeoutMs`.
 *
 * @param queues - The queues (absent ones are skipped).
 * @param timeoutMs - Per-step timeout in milliseconds.
 * @param logger - Logger for timeout warnings.
 * @returns `true` when every stop finished, i.e. no run is still in flight.
 */
export async function drainQueues(
  queues: ShutdownQueues,
  timeoutMs: number,
  logger: pino.Logger | undefined,
): Promise<boolean> {
  let idle = true;
  if (queues.queue) {
    idle = await drainThenStop('Queue', queues.queue, timeoutMs, logger);
  }
  if (queues.sourceQueue) {
    const { sourceQueue } = queues;
    const stopped = await drainThenStop(
      'Source queue',
      sourceQueue,
      timeoutMs,
      logger,
    );
    idle = stopped && idle;
  }
  return idle;
}

/** Components stopped by {@link shutdownComponents} (absent ones are skipped). */
export interface ShutdownComponents extends ShutdownQueues {
  /** The API server: closed first, so no new notification is accepted. */
  server?: { close: () => Promise<unknown> };
  /** Producers stopped after the server, in order (config watch, VCS, watcher). */
  producers?: Array<{ stop: () => Promise<unknown> } | undefined>;
  /** Values index (always flushed: an in-memory snapshot write). */
  valuesManager?: { stopAutoFlush: () => void; flush: () => void };
  /** Stores closed only when no run is still in flight. */
  stores?: Array<{ close: () => void } | undefined>;
}

/**
 * Stop every component in a safe order: close the API server (bounded), stop
 * producers, drain and stop the queues (bounded), flush the values index, and
 * close stores. When a queue step timed out, runs may still be in flight, so
 * stores are left open (the process exits) rather than closed under them.
 *
 * @param components - The components.
 * @param timeoutMs - Per-step timeout in milliseconds.
 * @param logger - Logger for warnings.
 */
export async function shutdownComponents(
  components: ShutdownComponents,
  timeoutMs: number,
  logger: pino.Logger | undefined,
): Promise<void> {
  const { server, producers = [], valuesManager, stores = [] } = components;
  if (server) await step('API server close', server.close(), timeoutMs, logger);
  for (const producer of producers) await producer?.stop();

  const idle = await drainQueues(components, timeoutMs, logger);

  valuesManager?.stopAutoFlush();
  valuesManager?.flush();
  if (idle) {
    for (const store of stores) store?.close();
  } else {
    logger?.warn(
      'Runs still in flight after shutdown timeout; stores left open',
    );
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
