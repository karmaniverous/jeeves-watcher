/**
 * @module options
 * Client options for createWatcherClient and their validation/normalisation (base URL, API key, timeout, fetch injection). Pure; throws WatcherError invalid_options.
 */

import { WatcherError } from './WatcherError.js';

/**
 * Default request timeout in milliseconds. Shorter than the server's
 * longest waits (`RootGitLock` 30 s, document lock 10 s): raise `timeoutMs`
 * for state-changing VCS calls and `documents.notify(..., { wait: true })`.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** A `fetch`-compatible function (the global `fetch` by default). */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Options for {@link createWatcherClient}. */
export interface WatcherClientOptions {
  /** Base URL of the watcher API, e.g. `http://watcher.internal.example:1936`. May carry a path prefix; must not carry a query string or fragment. */
  baseUrl: string;
  /** API key sent as `Authorization: Bearer <apiKey>` (watcher `api.apiKey`). Never sent to `status`. */
  apiKey?: string;
  /** Per-request timeout in milliseconds. Default: 10000. */
  timeoutMs?: number;
  /** `fetch` implementation (for tests or custom agents). Default: global `fetch`. */
  fetch?: FetchLike;
}

/** Validated, normalised client options. */
export interface ResolvedClientOptions {
  /** Base URL without trailing slashes. */
  baseUrl: string;
  /** API key, when set. */
  apiKey?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** The caller's fetch (or the global one), in the signature jeeves's catalog client takes. */
  fetch: typeof fetch;
}

const invalid = (message: string): WatcherError =>
  new WatcherError({ code: 'invalid_options', message });

/**
 * Adapt a {@link FetchLike} to the `fetch` signature jeeves's catalog client
 * takes. The client always passes a URL string and an init object.
 *
 * @param fetchImpl - The caller's fetch.
 * @returns A `typeof fetch` that calls `fetchImpl`.
 */
function adaptFetch(fetchImpl: FetchLike): typeof fetch {
  return (input, init) =>
    fetchImpl(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      init ?? {},
    );
}

/**
 * Validate and normalise client options.
 *
 * @param options - Caller options.
 * @returns Resolved options.
 * @throws {@link WatcherError} `invalid_options` on a bad base URL (not http(s), or carrying a query string or fragment), empty API key, non-positive timeout or missing `fetch`.
 */
export function resolveClientOptions(
  options: WatcherClientOptions,
): ResolvedClientOptions {
  const { baseUrl, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  if (!URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol)) {
    throw invalid(`baseUrl must be an http(s) URL, got "${baseUrl}"`);
  }
  // Entry paths are appended to baseUrl, so a query or fragment would
  // swallow them. Check the raw string: URL drops an empty `?` or `#`.
  if (/[?#]/.test(baseUrl)) {
    throw invalid(
      `baseUrl must not contain a query string or fragment, got "${baseUrl}"`,
    );
  }
  if (apiKey?.length === 0) {
    throw invalid('apiKey must be a non-empty string when set');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw invalid('timeoutMs must be a positive number');
  }
  const fetchImpl =
    options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (fetchImpl === undefined) {
    throw invalid('No fetch implementation available; pass options.fetch');
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    timeoutMs,
    fetch: adaptFetch(fetchImpl),
  };
}
