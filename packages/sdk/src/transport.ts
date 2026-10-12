/**
 * @module transport
 * One HTTP round trip against a catalog endpoint: client-side body validation, Bearer auth, timeout via AbortController, error mapping and response validation. Network I/O via the injected fetch.
 */

import {
  type EndpointName,
  getEndpoint,
} from '@karmaniverous/jeeves-watcher-core';

import { httpError, tryParseJson } from './httpError.js';
import type { ResolvedClientOptions } from './options.js';
import { WatcherError } from './WatcherError.js';

/**
 * Structural view of a Zod schema: just `safeParse`. Lets the SDK validate
 * with core schemas without depending on `zod` directly.
 */
export interface SchemaLike<T> {
  /** Validate `data` without throwing. */
  safeParse(
    data: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly unknown[] } };
}

/** One request against a catalog endpoint. */
export interface RequestSpec<T> {
  /** Catalog endpoint name; supplies method and path. */
  endpoint: EndpointName;
  /** Request body (JSON). */
  body?: unknown;
  /** Schema the body must satisfy before anything is sent. */
  bodySchema?: SchemaLike<unknown>;
  /** Query string parameters. */
  query?: Record<string, string>;
  /** Schema the 2xx response body must satisfy. */
  responseSchema: SchemaLike<T>;
}

/** Performs a {@link RequestSpec} and resolves with the validated response body. */
export type Transport = <T>(spec: RequestSpec<T>) => Promise<T>;

const firstIssueMessage = (issues: readonly unknown[]): string => {
  const first = issues[0];
  if (typeof first === 'object' && first !== null && 'message' in first) {
    return String(first.message);
  }
  return 'validation failed';
};

/**
 * Validate a request body; returns the parsed body.
 *
 * @param spec - The request.
 * @returns The body to send (schema output), or the raw body without a schema.
 */
function validateBody(spec: RequestSpec<unknown>): unknown {
  if (spec.bodySchema === undefined) return spec.body;
  const result = spec.bodySchema.safeParse(spec.body);
  if (result.success) return result.data;
  throw new WatcherError({
    code: 'invalid_request',
    message: `Invalid ${spec.endpoint} request: ${firstIssueMessage(result.error.issues)}`,
    details: result.error.issues,
  });
}

/**
 * Validate a 2xx response body. On success the body is returned as received
 * (not the schema output), so fields added by newer servers are preserved.
 *
 * @param spec - The request.
 * @param status - HTTP status.
 * @param text - Raw response body.
 * @returns The response body.
 */
function parseResponse<T>(spec: RequestSpec<T>, status: number, text: string) {
  const body = tryParseJson(text);
  if (body === undefined) {
    throw new WatcherError({
      code: 'invalid_response',
      status,
      message: `${spec.endpoint} returned a non-JSON response`,
      details: text,
    });
  }
  const result = spec.responseSchema.safeParse(body);
  if (!result.success) {
    throw new WatcherError({
      code: 'invalid_response',
      status,
      message: `${spec.endpoint} response did not match the expected shape: ${firstIssueMessage(result.error.issues)}`,
      details: result.error.issues,
    });
  }
  return body as T;
}

/**
 * Create the transport for a client.
 *
 * @param options - Resolved client options.
 * @returns A {@link Transport}.
 */
export function createTransport(options: ResolvedClientOptions): Transport {
  return async <T>(spec: RequestSpec<T>): Promise<T> => {
    const { method, path } = getEndpoint(spec.endpoint);
    const hasBody = spec.body !== undefined || spec.bodySchema !== undefined;
    const body = hasBody ? validateBody(spec) : undefined;
    const query = new URLSearchParams(spec.query).toString();
    const url = `${options.baseUrl}${path}${query ? `?${query}` : ''}`;

    const headers: Record<string, string> = { accept: 'application/json' };
    if (hasBody) headers['content-type'] = 'application/json';
    if (options.apiKey !== undefined) {
      headers.authorization = `Bearer ${options.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, options.timeoutMs);
    try {
      const res = await options.fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw httpError(res.status, res.statusText, text);
      return parseResponse(spec, res.status, text);
    } catch (err) {
      if (err instanceof WatcherError) throw err;
      if (controller.signal.aborted) {
        throw new WatcherError({
          code: 'timeout',
          message: `${spec.endpoint} timed out after ${String(options.timeoutMs)} ms`,
          cause: err,
        });
      }
      throw new WatcherError({
        code: 'network_error',
        message: `${spec.endpoint} request failed: ${err instanceof Error ? err.message : String(err)}`,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
