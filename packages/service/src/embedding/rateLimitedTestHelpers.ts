/**
 * @module embedding/rateLimitedTestHelpers
 * Test helpers for RateLimitedEmbeddingProvider: a mock inner provider and a promise state tracker. Test-only; no I/O.
 */

import { vi } from 'vitest';

import type { EmbeddingProvider, EmbedOptions } from './types';

/** A mock inner provider returning one 2-d vector per text. */
export function makeInner() {
  const embed = vi.fn<
    (texts: string[], options?: EmbedOptions) => Promise<number[][]>
  >((texts) => Promise.resolve(texts.map(() => [0.1, 0.2])));
  const inner: EmbeddingProvider = { dimensions: 2, embed };
  return { inner, embed };
}

/** Collect the settled state of a promise without awaiting it. */
export function track<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  promise.then(
    (value) => {
      state.done = true;
      state.value = value;
    },
    (error: unknown) => {
      state.done = true;
      state.error = error;
    },
  );
  return state;
}
