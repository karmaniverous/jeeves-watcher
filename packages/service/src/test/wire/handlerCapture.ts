/**
 * @module test/wire/handlerCapture
 * Records what catalog handlers resolve to, each record tagged with the test scope (an `AsyncLocalStorage` token) whose request caused it, so a test reads only its own records: a late call from an abandoned (timed-out) test cannot land in a later test's expectations. In memory; no I/O.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** What a catalog handler resolves to, as far as these tests look. */
export interface RecordedResult {
  status: number;
  body: unknown;
}

/** One handler call: the catalog entry, its result and the calling scope. */
interface CapturedResult {
  entry: string;
  result: RecordedResult;
  /** The scope token, or `undefined` outside any scope (real HTTP). */
  token: symbol | undefined;
}

/** A catalog handler, as far as these tests call it. */
type AnyHandler = (...call: unknown[]) => Promise<RecordedResult>;

const scope = new AsyncLocalStorage<symbol>();
const captured: CapturedResult[] = [];

/**
 * Wrap every handler so each result is recorded under the current scope.
 *
 * @param handlers - Catalog handlers keyed by entry.
 * @returns The same handlers, recording.
 */
export function captureHandlers<T extends object>(handlers: T): T {
  return Object.fromEntries(
    Object.entries(handlers).map(([entry, handler]) => [
      entry,
      async (...call: unknown[]) => {
        const token = scope.getStore();
        const result = await (handler as AnyHandler)(...call);
        captured.push({ entry, result, token });
        return result;
      },
    ]),
  ) as T;
}

/**
 * Run `fn` in a fresh scope and return its value with the handler results it
 * caused (in call order). Fastify `inject` stays in the caller's async
 * context, so every handler it reaches is attributed to this scope.
 *
 * @param fn - The work (normally one injected request).
 * @returns The value and this scope's results.
 */
export async function inScope<T>(fn: () => Promise<T>): Promise<{
  value: T;
  results: Array<{ entry: string; result: RecordedResult }>;
}> {
  const token = Symbol('scope');
  const value = await scope.run(token, fn);
  return { value, results: resultsFor(token) };
}

/**
 * Handler results recorded under `token`, in call order.
 *
 * @param token - A scope token, or `undefined` for calls outside any scope
 * (requests over real HTTP).
 * @returns The results.
 */
export function resultsFor(
  token: symbol | undefined,
): Array<{ entry: string; result: RecordedResult }> {
  return captured
    .filter((record) => record.token === token)
    .map(({ entry, result }) => ({ entry, result }));
}

/** Forget every recorded result (call in `beforeEach`). */
export function clearCaptured(): void {
  captured.length = 0;
}
