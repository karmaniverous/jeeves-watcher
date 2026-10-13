/**
 * @module test/harness/faultyProvider
 * Embedding provider stub for integration tests: forwards to a real (mock) provider, but can be armed to fail its next request with an HTTP-429-style {@link EmbeddingRateLimitError} or any other error; records when each request reached it. No I/O.
 */

import type { EmbeddingProvider } from '../../embedding';
import { EmbeddingRateLimitError } from '../../embedding/rateLimitError';

/** One request that reached the stub. */
export interface FaultyProviderCall {
  /** `Date.now()` when the request arrived. */
  at: number;
  /** Whether it was answered (`false`: it failed as armed). */
  ok: boolean;
}

/** A fault-injecting provider and its controls. */
export interface FaultyProvider {
  /** The provider to wrap (e.g. in the shared rate limiter). */
  provider: EmbeddingProvider;
  /** Every request that reached the stub, in arrival order. */
  calls: FaultyProviderCall[];
  /** Fail the next request with a 429 asking for `retryAfterMs`. */
  rateLimitNext: (retryAfterMs: number) => void;
  /** Fail the next request with `error`. */
  failNext: (error: Error) => void;
}

/**
 * Wrap a provider so its next request can be made to fail.
 *
 * @param inner - The provider that answers un-armed requests.
 * @returns The stub and its controls.
 */
export function faultyProvider(inner: EmbeddingProvider): FaultyProvider {
  const calls: FaultyProviderCall[] = [];
  let armed: Error | undefined;
  const provider: EmbeddingProvider = {
    dimensions: inner.dimensions,
    embed: (texts, options) => {
      const fault = armed;
      armed = undefined;
      calls.push({ at: Date.now(), ok: !fault });
      if (fault) return Promise.reject(fault);
      return inner.embed(texts, options);
    },
  };
  return {
    provider,
    calls,
    rateLimitNext: (retryAfterMs) => {
      armed = new EmbeddingRateLimitError(
        'HTTP 429 Too Many Requests',
        retryAfterMs,
      );
    },
    failNext: (error) => {
      armed = error;
    },
  };
}
