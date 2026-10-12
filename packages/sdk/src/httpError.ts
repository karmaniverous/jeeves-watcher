/**
 * @module httpError
 * Maps a non-2xx watcher response (status + raw body text) to a WatcherError, taking code/message/details from the JSON error body when present. Pure.
 */

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
 * Build the error for a non-2xx response.
 *
 * - `code`: `body.code`, else `body.error`, else `http_<status>`.
 * - `message`: `body.message`, else `body.error`, else `HTTP <status> <statusText>`.
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
  return new WatcherError({
    status,
    code:
      stringField(body, 'code') ??
      stringField(body, 'error') ??
      `http_${String(status)}`,
    message:
      stringField(body, 'message') ??
      stringField(body, 'error') ??
      fallbackMessage,
    details,
  });
}
