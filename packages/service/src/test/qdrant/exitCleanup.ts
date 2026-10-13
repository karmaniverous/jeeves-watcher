/**
 * @module test/qdrant/exitCleanup
 * Best-effort synchronous cleanup of the throwaway Qdrant when the test process exits abnormally (process `exit`, SIGINT, SIGTERM, SIGHUP).
 * {@link registerExitCleanup} installs the hooks; the returned function removes them after a normal teardown.
 */

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** Conventional exit codes (128 + signal number). */
const SIGNAL_EXIT_CODES: Record<(typeof SIGNALS)[number], number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

/**
 * Run `cleanup` (once) if the process exits or is signalled before the
 * returned unregister function is called. `cleanup` must be synchronous.
 * When no other listener handles a signal, the process exits with the
 * conventional code after cleaning up, matching the default behaviour.
 *
 * @param cleanup - Synchronous cleanup; errors are swallowed.
 * @param proc - Process to hook (default `process`; injectable for tests).
 * @returns Unregister function (call after a normal teardown).
 */
export function registerExitCleanup(
  cleanup: () => void,
  proc: NodeJS.Process = process,
): () => void {
  let done = false;
  const runOnce = (): void => {
    if (done) return;
    done = true;
    try {
      cleanup();
    } catch {
      // Best effort: never mask the original exit reason.
    }
  };

  const signalHandlers = SIGNALS.map((signal) => {
    const handler = (): void => {
      runOnce();
      if (proc.listenerCount(signal) === 0)
        proc.exit(SIGNAL_EXIT_CODES[signal]);
    };
    proc.once(signal, handler);
    return { signal, handler };
  });
  proc.once('exit', runOnce);

  return () => {
    done = true;
    proc.removeListener('exit', runOnce);
    for (const { signal, handler } of signalHandlers) {
      proc.removeListener(signal, handler);
    }
  };
}
