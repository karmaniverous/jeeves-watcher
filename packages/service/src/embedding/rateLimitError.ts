/**
 * @module embedding/rateLimitError
 * Embedding rate-limit errors and `Retry-After` parsing (seconds, HTTP-date, or Google `RetryInfo.retryDelay` in the body). Pure; no I/O.
 */

/**
 * Thrown by a provider when the upstream API rejects a request with HTTP 429.
 * The shared limiter catches it, pauses every caller and retries.
 */
export class EmbeddingRateLimitError extends Error {
  /** Delay requested by the provider before the next request, in ms. */
  readonly retryAfterMs: number | undefined;

  /**
   * @param message - Provider error message.
   * @param retryAfterMs - Delay requested by the provider, when known.
   */
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'EmbeddingRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown by the shared limiter when a call's retry or wait budget is
 * exhausted. The search route maps it to HTTP 503.
 */
export class EmbeddingUnavailableError extends Error {
  /** Time until the limiter expects to accept requests again, in ms. */
  readonly retryAfterMs: number | undefined;

  /**
   * @param message - Description of the exhausted budget.
   * @param options - The last provider error and the expected wait.
   */
  constructor(
    message: string,
    options: { cause?: unknown; retryAfterMs?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'EmbeddingUnavailableError';
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Parse a `Retry-After` header value (delta-seconds or HTTP-date). */
function parseHeader(value: string, nowMs: number): number | undefined {
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed) * 1000);
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - nowMs);
}

/** Parse a Google `RetryInfo.retryDelay` (e.g. `"17s"`, `"1.5s"`) from a JSON error body. */
function parseBodyRetryDelay(body: string): number | undefined {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}

/**
 * Resolve the delay a provider asked for on a 429 response. The
 * `Retry-After` header wins; otherwise a Google `RetryInfo.retryDelay` in
 * the response body is used.
 *
 * @param header - The `Retry-After` header value(s), if any.
 * @param body - The raw response body, if any.
 * @param nowMs - Current time, for HTTP-date values.
 * @returns The delay in milliseconds, or `undefined` when none was given.
 */
export function parseRetryAfterMs(
  header: string | string[] | undefined,
  body?: string,
  nowMs: number = Date.now(),
): number | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const fromHeader = value ? parseHeader(value, nowMs) : undefined;
  if (fromHeader !== undefined) return fromHeader;
  return body ? parseBodyRetryDelay(body) : undefined;
}
