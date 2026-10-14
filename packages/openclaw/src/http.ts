/**
 * @module plugin/http
 * The plugin's single HTTP helper for watcher API calls: JSON GET/POST via `fetch` with the core bearer header and the core error mapping (errors carry the server `code`; 401 adds key guidance). Never logs the key.
 */

import {
  API_KEY_ENV_VAR,
  bearerHeaders,
  formatHttpError,
  httpError,
  unauthorizedMessage,
} from '@karmaniverous/jeeves-watcher-core';

import { PLUGIN_ID } from './constants.js';

/** Where the plugin reads its API key from (named in 401 guidance). */
export const PLUGIN_KEY_SOURCES = `plugins.entries.${PLUGIN_ID}.config.apiKey or the ${API_KEY_ENV_VAR} env var`;

/**
 * Build the `fetch` init for a request. With no key and no body this is
 * `undefined`, exactly as an unauthenticated GET has always been sent.
 *
 * @param body - JSON body; `undefined` for a GET.
 * @param apiKey - Bearer key, if any.
 * @returns The request init.
 */
function buildInit(
  body: unknown,
  apiKey: string | undefined,
): RequestInit | undefined {
  const auth = bearerHeaders(apiKey);
  if (body === undefined) {
    return apiKey === undefined ? undefined : { headers: auth };
  }
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(body),
  };
}

/**
 * Call the watcher API and return the parsed JSON body.
 *
 * @param url - Full request URL.
 * @param body - JSON body; `undefined` sends a GET, anything else a POST.
 * @param apiKey - Bearer key; `undefined` sends no `Authorization` header.
 * @returns Parsed JSON response body.
 * @throws On `401` with core `unauthorizedMessage` (naming
 *   {@link PLUGIN_KEY_SOURCES}); on any other non-OK status with
 *   `HTTP <status> <code>: <message>` (core `httpError`); network errors
 *   propagate unchanged.
 */
export async function requestJson(
  url: string,
  body: unknown,
  apiKey: string | undefined,
): Promise<unknown> {
  const res = await fetch(url, buildInit(body, apiKey));
  if (res.status === 401) {
    throw new Error(
      unauthorizedMessage(apiKey !== undefined, PLUGIN_KEY_SOURCES),
    );
  }
  if (!res.ok) {
    const info = httpError(res.status, res.statusText, await res.text());
    throw new Error(formatHttpError(info));
  }
  return res.json();
}
