/**
 * @module cli/jeeves-watcher/apiClient
 * Shared HTTP client for every CLI command that calls the watcher API: JSON GET/POST via `fetch` with the core bearer header and core error mapping (errors carry the server `code`; 401 adds key guidance). Never prints the key.
 *
 * @remarks
 * Key resolution ({@link resolveApiKey}): the `--api-key` flag, then the
 * `JEEVES_WATCHER_API_KEY` environment variable (core `API_KEY_ENV_VAR`). The
 * API commands do not load the watcher config file, so `api.apiKey` from
 * config is not consulted.
 */

import {
  API_KEY_ENV_VAR,
  bearerHeaders,
  formatHttpError,
  httpError,
  unauthorizedMessage,
} from '@karmaniverous/jeeves-watcher-core';
import { z } from 'zod';

/** Where the CLI reads its API key from (named in 401 guidance). */
export const CLI_KEY_SOURCES = `--api-key or the ${API_KEY_ENV_VAR} env var`;

/** Options for {@link createApiClient}; the Zod schema is the source of truth. */
const apiClientOptionsSchema = z.object({
  /** API base URL, e.g. `http://127.0.0.1:1936`. */
  baseUrl: z.string().min(1),
  /** Bearer key; omitted = no `Authorization` header. */
  apiKey: z.string().min(1).optional(),
});

/** Options for {@link createApiClient}. */
export type ApiClientOptions = z.infer<typeof apiClientOptionsSchema>;

/** Minimal JSON client bound to one API base URL and (optional) key. */
export interface ApiClient {
  /** GET `path` and return the parsed JSON body. */
  get: (path: string) => Promise<unknown>;
  /** POST `body` as JSON to `path` and return the parsed JSON body. */
  post: (path: string, body: unknown) => Promise<unknown>;
}

/** Treat missing and blank values as unset. */
function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

/**
 * Resolve the API key for a CLI invocation. Pure.
 *
 * @param flag - Value of the `--api-key` option, if given.
 * @param env - Environment to read `API_KEY_ENV_VAR` from.
 * @returns The first non-blank of `flag` and the env var, or `undefined`.
 */
export function resolveApiKey(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return nonBlank(flag) ?? nonBlank(env[API_KEY_ENV_VAR]);
}

/**
 * Error text for a `401` CLI response (core `unauthorizedMessage` naming
 * {@link CLI_KEY_SOURCES}). Never contains the key. Pure.
 *
 * @param keySent - Whether the request carried a bearer key.
 * @returns Guidance on supplying (or checking) the key.
 */
export function cliUnauthorizedMessage(keySent: boolean): string {
  return unauthorizedMessage(keySent, CLI_KEY_SOURCES);
}

/**
 * Send one request; map 401 and other non-OK statuses to errors.
 *
 * @param url - Full request URL.
 * @param init - Request init.
 * @param keySent - Whether the request carries a bearer key.
 * @returns The parsed JSON body.
 * @throws On `401` with {@link cliUnauthorizedMessage}; on any other non-OK
 *   status with
 *   `HTTP <status> <code>: <message>`.
 */
async function send(
  url: string,
  init: RequestInit | undefined,
  keySent: boolean,
): Promise<unknown> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    throw new Error(cliUnauthorizedMessage(keySent));
  }
  if (!res.ok) {
    const info = httpError(res.status, res.statusText, await res.text());
    throw new Error(formatHttpError(info));
  }
  return res.json();
}

/**
 * Create a JSON client for the watcher API.
 *
 * @param options - Base URL and optional bearer key.
 * @returns A client whose requests carry `Authorization: Bearer <apiKey>`
 *   when a key is set, and no `Authorization` header otherwise.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const { baseUrl, apiKey } = apiClientOptionsSchema.parse(options);
  const keySent = apiKey !== undefined;
  const auth = bearerHeaders(apiKey);

  return {
    get: (path) =>
      send(
        `${baseUrl}${path}`,
        keySent ? { headers: auth } : undefined,
        keySent,
      ),
    post: (path, body) =>
      send(
        `${baseUrl}${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify(body),
        },
        keySent,
      ),
  };
}
