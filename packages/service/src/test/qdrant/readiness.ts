/**
 * @module test/qdrant/readiness
 * Probe a Qdrant HTTP endpoint once, or poll it until it answers 2xx or a deadline passes. Network I/O via an injectable `fetch`; timing via `setTimeout` (fake-timer friendly).
 * Used to wait for a freshly started throwaway Qdrant before tests run.
 */

/** Options for {@link waitForQdrantReady}. */
export interface ReadinessOptions {
  /** Give up after this many milliseconds (default 60 000). */
  timeoutMs?: number;
  /** Delay between probes in milliseconds (default 250). */
  intervalMs?: number;
  /** Per-probe request timeout in milliseconds (default 2 000). */
  probeTimeoutMs?: number;
  /** Probe path (default `/readyz`). */
  path?: string;
  /** `fetch` implementation (default global `fetch`). */
  fetchImpl?: typeof fetch;
  /**
   * Called before each probe; return a reason string to abort early
   * (e.g. the Qdrant process exited).
   */
  abortReason?: () => string | undefined;
}

/**
 * Probe a Qdrant endpoint once (any failure counts as not ready).
 *
 * @param url - Full endpoint URL, e.g. `http://127.0.0.1:6333/healthz`.
 * @param fetchImpl - `fetch` implementation (default global `fetch`).
 * @param timeoutMs - Request timeout in milliseconds (default 2 000).
 * @returns `true` when the endpoint answered 2xx.
 */
export async function probeQdrant(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2_000,
): Promise<boolean> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Wait until `baseUrl` + `path` answers 2xx.
 *
 * @param baseUrl - Qdrant base URL, e.g. `http://127.0.0.1:51234`.
 * @param options - Timing and injection options.
 * @throws When the deadline passes or `abortReason` reports a reason.
 */
export async function waitForQdrantReady(
  baseUrl: string,
  options: ReadinessOptions = {},
): Promise<void> {
  const {
    timeoutMs = 60_000,
    intervalMs = 250,
    probeTimeoutMs = 2_000,
    path = '/readyz',
    fetchImpl = fetch,
    abortReason,
  } = options;
  const url = `${baseUrl}${path}`;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const reason = abortReason?.();
    if (reason) throw new Error(`Qdrant at ${baseUrl} not ready: ${reason}`);
    if (await probeQdrant(url, fetchImpl, probeTimeoutMs)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Qdrant at ${baseUrl} not ready after ${String(timeoutMs)} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
