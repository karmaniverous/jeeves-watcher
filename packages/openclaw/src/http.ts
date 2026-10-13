/**
 * @module plugin/http
 * The plugin's single HTTP helper for watcher API calls: JSON GET/POST via `fetch` with an optional `Authorization: Bearer` header and actionable 401 errors. Never logs the key.
 */

import { API_KEY_ENV_VAR, PLUGIN_ID } from './constants.js';

/**
 * Error message for a `401` response. Never contains the key. Pure.
 *
 * @param keySent - Whether the request carried a bearer key.
 * @returns Guidance on supplying (or checking) the key.
 */
export function unauthorizedMessage(keySent: boolean): string {
  const where = `plugins.entries.${PLUGIN_ID}.config.apiKey or the ${API_KEY_ENV_VAR} env var`;
  return keySent
    ? `HTTP 401: the watcher API rejected the configured API key. Check ${where} against the service's api.apiKey.`
    : `HTTP 401: the watcher API requires an API key. Set ${where}.`;
}

/**
 * Build the `fetch` init for a request. With no key and no body this is
 * `undefined`, exactly as an unauthenticated GET has always been sent.
 */
function buildInit(
  body: unknown,
  apiKey: string | undefined,
): RequestInit | undefined {
  const auth: Record<string, string> =
    apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` };

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
 * @throws On `401` with {@link unauthorizedMessage}; on any other non-OK
 *   status with `HTTP <status>: <body>`; network errors propagate unchanged.
 */
export async function requestJson(
  url: string,
  body: unknown,
  apiKey: string | undefined,
): Promise<unknown> {
  const res = await fetch(url, buildInit(body, apiKey));
  if (res.status === 401) {
    throw new Error(unauthorizedMessage(apiKey !== undefined));
  }
  if (!res.ok) {
    throw new Error(`HTTP ${String(res.status)}: ${await res.text()}`);
  }
  return res.json();
}
