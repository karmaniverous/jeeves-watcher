/**
 * @module cli/jeeves-watcher/apiClient
 * Shared HTTP client for every CLI command that calls the watcher API: JSON GET/POST via `fetch`, optional `Authorization: Bearer` header, actionable 401 errors. Never prints the key.
 *
 * @remarks
 * Key resolution ({@link resolveApiKey}): the `--api-key` flag, then the
 * `JEEVES_WATCHER_API_KEY` environment variable. The API commands do not load
 * the watcher config file, so `api.apiKey` from config is not consulted.
 */

import { z } from 'zod';

/** Environment variable holding the API bearer key for CLI commands. */
export const API_KEY_ENV_VAR = 'JEEVES_WATCHER_API_KEY';

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
 * @param env - Environment to read {@link API_KEY_ENV_VAR} from.
 * @returns The first non-blank of `flag` and the env var, or `undefined`.
 */
export function resolveApiKey(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return nonBlank(flag) ?? nonBlank(env[API_KEY_ENV_VAR]);
}

/**
 * Error message for a `401` response. Never contains the key. Pure.
 *
 * @param keySent - Whether the request carried a bearer key.
 * @returns Guidance on supplying (or checking) the key.
 */
export function unauthorizedMessage(keySent: boolean): string {
  return keySent
    ? `HTTP 401: the watcher API rejected the API key. Check --api-key or ${API_KEY_ENV_VAR} against the service's api.apiKey.`
    : `HTTP 401: the watcher API requires an API key. Pass --api-key <key> or set the ${API_KEY_ENV_VAR} environment variable.`;
}

/** Send one request; map 401 and other non-OK statuses to errors. */
async function send(
  url: string,
  init: RequestInit | undefined,
  keySent: boolean,
): Promise<unknown> {
  const res = await fetch(url, init);
  if (res.status === 401) throw new Error(unauthorizedMessage(keySent));
  if (!res.ok) {
    throw new Error(`HTTP ${String(res.status)}: ${await res.text()}`);
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
  const auth: Record<string, string> = keySent
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

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
