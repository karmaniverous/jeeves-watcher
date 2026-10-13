/**
 * @module sources/requestSource
 * Performs one source callback GET (headers, timeout, no redirects) and maps the HTTP outcome to a SourceRetrievalResult. Network I/O via global fetch.
 */

import { SOURCE_DOCUMENT_GONE_STATUS } from '@karmaniverous/jeeves-watcher-core';

import type {
  SourceErrorCode,
  SourceRequest,
  SourceRetrievalResult,
} from './types';

/** The only content type accepted from a callback (Decision 16.5). */
const JSON_CONTENT_TYPE = 'application/json';

/** Status of a successful callback. */
const OK_STATUS = 200;

/** Largest callback response body accepted (10 MiB). */
export const MAX_SOURCE_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Read a response body as UTF-8, giving up once it exceeds `maxBytes`
 * (checked against `Content-Length` first, then while streaming).
 *
 * @param response - The response.
 * @param maxBytes - Size cap in bytes.
 * @returns The text, or `undefined` when the body is too large.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const declared = Number(response.headers.get('content-length') ?? NaN);
  if (declared > maxBytes || !response.body) {
    await response.body?.cancel();
    return declared > maxBytes ? undefined : '';
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    const value: Uint8Array = result.value;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function error(code: SourceErrorCode, message: string): SourceRetrievalResult {
  return { kind: 'error', code, message };
}

/** Media type of a `Content-Type` header, lower-cased, parameters dropped. */
function mediaType(header: string | null): string {
  return (header ?? '').split(';', 1)[0].trim().toLowerCase();
}

/**
 * A safe description of a thrown fetch error: only the system error code
 * (e.g. `ECONNREFUSED`) is surfaced, never free text that could echo the
 * URL or request details.
 */
function networkCause(err: unknown): string {
  const cause = err instanceof Error ? err.cause : undefined;
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? cause.code
      : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
    ? `network error (${code})`
    : 'network error';
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function classify(
  name: string,
  response: Response,
): Promise<SourceRetrievalResult> {
  const prefix = `Source "${name}" callback`;
  if (response.status === SOURCE_DOCUMENT_GONE_STATUS) {
    await response.body?.cancel();
    return { kind: 'gone' };
  }
  if (response.status !== OK_STATUS) {
    await response.body?.cancel();
    return error(
      'source_unavailable',
      `${prefix} returned HTTP ${String(response.status)}`,
    );
  }
  const type = mediaType(response.headers.get('content-type'));
  if (type !== JSON_CONTENT_TYPE) {
    await response.body?.cancel();
    return error(
      'unsupported_content_type',
      `${prefix} returned content type "${type || '(none)'}"; only ${JSON_CONTENT_TYPE} is supported`,
    );
  }
  const text = await readCapped(response, MAX_SOURCE_RESPONSE_BYTES);
  if (text === undefined) {
    return error(
      'source_unavailable',
      `${prefix} response too large (over ${String(MAX_SOURCE_RESPONSE_BYTES)} bytes)`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return error('source_unavailable', `${prefix} returned invalid JSON`);
  }
  if (!isJsonObject(body)) {
    return error(
      'unsupported_content_type',
      `${prefix} returned JSON that is not an object`,
    );
  }
  return { kind: 'document', body };
}

/**
 * Send one callback request and map its outcome. Never throws.
 *
 * Mapping: `200` + `application/json` (parameters such as `charset`
 * allowed) + JSON object → `document`; `404` → `gone`; `200` with another
 * content type or non-object JSON → `unsupported_content_type`; anything
 * else (timeout, network error, invalid JSON, a body over
 * {@link MAX_SOURCE_RESPONSE_BYTES} ("response too large"), `3xx` — redirects are not
 * followed — and every other status, including `4xx` such as `401`/`403`)
 * → `source_unavailable`, so a misconfigured or failing source can never
 * cause points to be deleted. Messages carry the source name and status
 * only: never the URL or header values.
 *
 * @param request - The request to send.
 * @returns The retrieval outcome.
 */
export async function requestSource(
  request: SourceRequest,
): Promise<SourceRetrievalResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: 'GET',
      headers: request.headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    return await classify(request.name, response);
  } catch (err) {
    if (controller.signal.aborted) {
      return error(
        'source_unavailable',
        `Source "${request.name}" callback timed out after ${String(request.timeoutMs)} ms`,
      );
    }
    return error(
      'source_unavailable',
      `Source "${request.name}" callback failed: ${networkCause(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
