/**
 * @module test/harness/countingProvider
 * Embedding provider wrapper for integration tests: forwards to the real (mock) provider and counts embed requests and texts, so tests can assert "zero embedding calls". No I/O.
 */

import type { EmbeddingProvider } from '../../embedding';

/** Running embed counters. */
export interface EmbedCounter {
  /** Number of `embed()` requests. */
  calls: number;
  /** Total number of texts embedded. */
  texts: number;
}

/** A counting provider plus its counters. */
export interface CountingProvider {
  /** The wrapped provider (pass this to the code under test). */
  provider: EmbeddingProvider;
  /** Live counters. */
  counter: EmbedCounter;
}

/**
 * Wrap a provider so every `embed()` request is counted.
 *
 * @param inner - The provider to forward to.
 * @returns The wrapper and its live counters.
 */
export function countingProvider(inner: EmbeddingProvider): CountingProvider {
  const counter: EmbedCounter = { calls: 0, texts: 0 };
  const provider: EmbeddingProvider = {
    dimensions: inner.dimensions,
    embed: (texts, options) => {
      counter.calls += 1;
      counter.texts += texts.length;
      return inner.embed(texts, options);
    },
  };
  return { provider, counter };
}
