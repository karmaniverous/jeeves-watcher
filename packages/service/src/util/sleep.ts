/**
 * @module util/sleep
 * Abort-aware async sleep.
 */

/**
 * Sleep for a given duration with optional abort support.
 *
 * @param ms - Duration in milliseconds.
 * @param signal - Optional abort signal.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error('Sleep aborted'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
