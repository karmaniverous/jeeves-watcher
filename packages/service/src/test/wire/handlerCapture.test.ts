/**
 * @module test/wire/handlerCapture.test
 * Handler results are attributed to the scope whose request caused them: a call from an abandoned scope that finishes late never shows up in a later scope's results or among out-of-scope (real HTTP) calls. In memory.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  captureHandlers,
  clearCaptured,
  inScope,
  type RecordedResult,
  resultsFor,
} from './handlerCapture';

/** A handler that resolves `body` after `ms`. */
const after =
  (ms: number) =>
  (body: unknown): Promise<RecordedResult> =>
    new Promise((resolve) =>
      setTimeout(() => {
        resolve({ status: 200, body });
      }, ms),
    );

const handlers = captureHandlers({ slow: after(30), fast: after(0) });

beforeEach(() => {
  clearCaptured();
});

describe('handler capture', () => {
  it('returns the handler result and records it under its scope', async () => {
    const { value, results } = await inScope(() => handlers.fast('a'));
    expect(value).toEqual({ status: 200, body: 'a' });
    expect(results).toEqual([
      { entry: 'fast', result: { status: 200, body: 'a' } },
    ]);
  });

  it('records calls outside any scope as unscoped', async () => {
    await handlers.fast('http');
    expect(resultsFor(undefined)).toEqual([
      { entry: 'fast', result: { status: 200, body: 'http' } },
    ]);
  });

  it('keeps a late result from an abandoned scope out of later ones', async () => {
    // A timed-out test's request: started, never awaited by its test.
    const abandoned = inScope(() => handlers.slow('late'));
    clearCaptured(); // the next test's beforeEach
    const { results } = await inScope(async () => {
      const value = await handlers.fast('mine');
      await abandoned; // the late result lands while this scope is open
      return value;
    });
    expect(results).toEqual([
      { entry: 'fast', result: { status: 200, body: 'mine' } },
    ]);
    expect(resultsFor(undefined)).toEqual([]);
    expect((await abandoned).results).toEqual([
      { entry: 'slow', result: { status: 200, body: 'late' } },
    ]);
  });
});
