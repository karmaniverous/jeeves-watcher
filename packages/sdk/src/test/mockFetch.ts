/**
 * @module test/mockFetch
 * Test helper: an injectable fetch that records every call and answers with canned JSON responses. No network.
 */

import type { FetchLike } from '../options.js';

/** One recorded fetch call. */
export interface RecordedCall {
  /** Requested URL. */
  url: string;
  /** HTTP method. */
  method: string;
  /** Request headers. */
  headers: Record<string, string>;
  /** Parsed JSON body, if any. */
  body: unknown;
  /** Abort signal passed by the client. */
  signal: AbortSignal | undefined;
}

/** A canned response. */
export interface CannedResponse {
  /** HTTP status (default 200). */
  status?: number;
  /** JSON body, or a raw string sent as-is. */
  body?: unknown;
}

/** A recording fetch plus its call log. */
export interface MockFetch {
  /** The fetch to inject. */
  fetch: FetchLike;
  /** Calls so far. */
  calls: RecordedCall[];
}

/**
 * Create a recording fetch.
 *
 * @param respond - Canned response, or a function of the call returning one.
 * @returns The fetch and its call log.
 */
export function mockFetch(
  respond: CannedResponse | ((call: RecordedCall) => CannedResponse) = {},
): MockFetch {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = (url, init) => {
    const call: RecordedCall = {
      url,
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      body:
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as unknown)
          : undefined,
      signal: init.signal ?? undefined,
    };
    calls.push(call);
    const canned = typeof respond === 'function' ? respond(call) : respond;
    const text =
      typeof canned.body === 'string'
        ? canned.body
        : JSON.stringify(canned.body ?? {});
    return Promise.resolve(
      new Response(text, { status: canned.status ?? 200 }),
    );
  };
  return { fetch, calls };
}
