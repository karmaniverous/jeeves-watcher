/**
 * @module httpError
 * Maps a non-2xx watcher response (status + raw body text) to a WatcherError: the canonical `code` and `error` text of a 0.20.0+ error body, else the legacy `error`/`message` fields. Pure.
 */

import { apiErrorCodeSchema } from '@karmaniverous/jeeves-watcher-core';

import { WatcherError } from './WatcherError.js';

/**
 * Parse text as JSON, returning `undefined` when it is not JSON.
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

const stringField = (body: unknown, key: string): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/**
 * Code and message of a 0.20.0+ error body: `code` is one of the canonical
 * API error codes and `error` is the human-readable text (`message`, when
 * present, is appended). Pure.
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
 * Build the error for a non-2xx response.
 *
 * - Canonical body (`code` is an `ApiErrorCode`, `error` is a string): `code`
 *   is `body.code`; `message` is `body.error`, plus `: <body.message>` when
 *   present.
 * - Otherwise (older servers, proxies): `code` is `body.code`, else
 *   `body.error`, else `http_<status>`; `message` is `body.message`, else
 *   `body.error`, else `HTTP <status> <statusText>`.
 * - `details`: `body.details` when present, else the parsed body (or raw text).
 *
 * @param status - HTTP status.
 * @param statusText - HTTP status text.
 * @param text - Raw response body.
 * @returns The mapped error.
 */
export function httpError(
  status: number,
  statusText: string,
  text: string,
): WatcherError {
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
  return new WatcherError({ status, ...mapped, details });
}
