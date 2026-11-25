/**
 * @module mcp/injectTransport
 * A `CatalogTransport` to the watcher's own routes, in-process: jeeves's `httpTransport` (which builds every request) over a `fetch` that calls Fastify's `inject` instead of the network. Each call passes the app's auth hook, validation, handlers and error mapping like an HTTP caller's, carrying any headers it is given (`/mcp` gives its caller's `Authorization`).
 */

import {
  type CatalogTransport,
  httpTransport,
} from '@karmaniverous/jeeves/catalog';
import type { FastifyInstance } from 'fastify';

/** Base URL `httpTransport` builds request URLs on; only path and query reach the app. */
const IN_PROCESS_BASE_URL = 'http://watcher.internal';

/** Statuses whose responses have no body (a `Response` refuses one). */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** Fastify's injected-response headers. */
type InjectedHeaders = Record<string, string | string[] | number | undefined>;

/**
 * Injected-response headers as a `Headers` object.
 *
 * @param raw - Injected-response headers.
 * @returns The headers.
 */
function headersOf(raw: InjectedHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value])
      headers.append(name, String(item));
  }
  return headers;
}

/**
 * Settle with `promise`, or reject with the signal's reason once it aborts.
 * `inject` cannot be cancelled: an aborted call stops being awaited, and the
 * route keeps running, as a timed-out HTTP request does on the server.
 *
 * @param promise - The pending call.
 * @param signal - Abort signal.
 * @returns The call's result.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/** How `httpTransport` calls its `fetch`: a URL string, method, headers, signal, maybe a JSON body. */
type TransportFetch = (
  url: string,
  init: RequestInit & { method: string; signal: AbortSignal },
) => Promise<Response>;

/**
 * The `fetch` `httpTransport` calls, answered by `app.inject`.
 *
 * @param app - The watcher's Fastify app.
 * @param headers - Headers added to every request.
 * @returns The fetch.
 */
function injectFetch(
  app: FastifyInstance,
  headers: Readonly<Record<string, string>>,
): TransportFetch {
  return async (url, init) => {
    const { pathname, search } = new URL(url);
    const res = await untilAborted(
      app.inject({
        method: init.method as 'GET',
        url: pathname + search,
        headers: {
          ...headers,
          ...Object.fromEntries(new Headers(init.headers)),
        },
        ...(typeof init.body === 'string' ? { payload: init.body } : {}),
      }),
      init.signal,
    );
    return new Response(
      NULL_BODY_STATUSES.has(res.statusCode) ? null : res.rawPayload,
      { status: res.statusCode, headers: headersOf(res.headers) },
    );
  };
}

/**
 * A transport sending catalog requests to `app`'s own routes.
 *
 * @param app - The watcher's Fastify app.
 * @param headers - Headers added to every request (e.g. the MCP caller's
 *   `Authorization`, so the auth hook admits its tool calls).
 * @returns The transport.
 */
export function injectTransport(
  app: FastifyInstance,
  headers: Readonly<Record<string, string>> = {},
): CatalogTransport {
  return httpTransport({
    baseUrl: IN_PROCESS_BASE_URL,
    // httpTransport calls fetch only as TransportFetch describes.
    fetch: injectFetch(app, headers) as typeof fetch,
  });
}
