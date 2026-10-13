/**
 * @module httpContract
 * The one HTTP client contract shared by the SDK, the CLI and the plugin: the API key env var, bearer header construction and the mapping of a non-2xx response (status + raw body) to `{ status, code, message, details }`. Pure.
 */

import { apiErrorCodeSchema } from './api/errors.js';

/** Environment variable holding the watcher API bearer key for clients (CLI, plugin). */
export const API_KEY_ENV_VAR = 'JEEVES_WATCHER_API_KEY';

/**
 * Request headers carrying the bearer key.
 *
 * @param apiKey - Bearer key; `undefined` means no key.
 * @returns `{ Authorization: 'Bearer <apiKey>' }`, or `{}` without a key.
 */
export function bearerHeaders(
  apiKey: string | undefined,
): Record<string, string> {
  return apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` };
}

/**
 * Parse text as JSON, returning `undefined` when it is empty or not JSON.
 *
 * @param text - Raw response body.
 * @returns The parsed value, or `undefined`.
 */
export function tryParseJson(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A non-2xx response mapped to its machine-readable parts. */
export interface HttpErrorInfo {
  /** HTTP status. */
  status: number;
  /** Server code (an `ApiErrorCode` from a 0.20.0+ service), or a fallback. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** `body.details`, else the parsed body, else the raw text (if any). */
  details?: unknown;
}

const stringField = (body: unknown, key: string): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/**
 * Code and message of a 0.20.0+ error body: `code` is one of the canonical
 * API error codes and `error` is the human-readable text (`message`, when
 * present and different, is appended).
 *
 * @param body - Parsed response body.
 * @returns Code and message, or `undefined` for any other body.
 */
function canonical(
  body: unknown,
): { code: string; message: string } | undefined {
  const code = apiErrorCodeSchema.safeParse(stringField(body, 'code'));
  const error = stringField(body, 'error');
  if (!code.success || error === undefined) return undefined;
  const extra = stringField(body, 'message');
  return {
    code: code.data,
    message:
      extra !== undefined && extra !== error ? `${error}: ${extra}` : error,
  };
}

/**
 * Map a non-2xx response to its code, message and details.
 *
 * - Canonical body (`code` is an `ApiErrorCode`, `error` is a string): `code`
 *   is `body.code`; `message` is `body.error`, plus `: <body.message>` when
 *   present.
 * - Otherwise (older servers, proxies): `code` is `body.code`, else
 *   `body.error`, else `http_<status>`; `message` is `body.message`, else
 *   `body.error`, else `HTTP <status> <statusText>`.
 * - `details`: `body.details` when present, else the parsed body (or raw
 *   text).
 *
 * @param status - HTTP status.
 * @param statusText - HTTP status text.
 * @param text - Raw response body.
 * @returns The mapped error parts.
 */
export function httpError(
  status: number,
  statusText: string,
  text: string,
): HttpErrorInfo {
  const body = tryParseJson(text);
  const fallbackMessage =
    `HTTP ${String(status)}${statusText ? ` ${statusText}` : ''}`.trim();
  const hasDetails =
    typeof body === 'object' && body !== null && 'details' in body;
  const details: unknown = hasDetails
    ? body.details
    : (body ?? (text.length > 0 ? text : undefined));
  const mapped = canonical(body) ?? {
    code:
      stringField(body, 'code') ??
      stringField(body, 'error') ??
      `http_${String(status)}`,
    message:
      stringField(body, 'message') ??
      stringField(body, 'error') ??
      fallbackMessage,
  };
  return { status, ...mapped, details };
}

/**
 * One-line text for a mapped error, as the CLI and plugin report it.
 *
 * @param info - The mapped error.
 * @returns `HTTP <status> <code>: <message>`.
 */
export function formatHttpError(info: HttpErrorInfo): string {
  return `HTTP ${String(info.status)} ${info.code}: ${info.message}`;
}

/**
 * Error text for a `401` response. Never contains the key.
 *
 * @param keySent - Whether the request carried a bearer key.
 * @param keySources - Where this client reads its key from (e.g. `--api-key or the JEEVES_WATCHER_API_KEY env var`).
 * @returns Guidance on supplying (or checking) the key.
 */
export function unauthorizedMessage(
  keySent: boolean,
  keySources: string,
): string {
  return keySent
    ? `HTTP 401 unauthorized: the watcher API rejected the API key. Check ${keySources} against the service's api.apiKey.`
    : `HTTP 401 unauthorized: the watcher API requires an API key. Provide it via ${keySources}.`;
}
