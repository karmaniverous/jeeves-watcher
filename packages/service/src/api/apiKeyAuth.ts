/**
 * @module api/apiKeyAuth
 * Optional Bearer API-key auth: a Fastify `onRequest` hook that rejects requests without `Authorization: Bearer <api.apiKey>` (except GET /status) with 401. Never logs the token.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

/** Body returned with every 401 response. */
export const UNAUTHORIZED_BODY = { error: 'Unauthorized' } as const;

const BEARER_PATTERN = /^Bearer[ \t]+(\S+)[ \t]*$/i;

/**
 * Hash a secret to a fixed-length digest so `timingSafeEqual` can compare
 * values of any length without throwing or leaking the length difference.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Check an `Authorization` header value against the expected key digest in
 * constant time. Pure.
 *
 * @param header - Raw `Authorization` header value, if any.
 * @param expectedDigest - SHA-256 digest of the configured API key.
 * @returns `true` only for `Bearer <key>` with the exact key.
 */
export function isAuthorized(
  header: string | undefined,
  expectedDigest: Buffer,
): boolean {
  const token = header ? BEARER_PATTERN.exec(header)?.[1] : undefined;
  // Always run one comparison so missing and malformed headers cost the same.
  const presented = digest(token ?? '');
  return timingSafeEqual(presented, expectedDigest) && token !== undefined;
}

/**
 * Whether a request is exempt from authentication: `GET /status` (and the
 * HEAD route Fastify derives from it), with or without a query string. Pure.
 *
 * @param method - HTTP method.
 * @param url - Raw request URL (path plus optional query string).
 * @returns `true` for the public health-check route.
 */
export function isPublicRoute(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const path = url.split('?', 1)[0];
  return path === getEndpoint('status').path;
}

/**
 * Register the API-key `onRequest` hook. No-op when `apiKey` is undefined
 * (unauthenticated, the pre-0.20.0 behaviour). Must be called before routes
 * are registered. The key is read once here; changing it needs a restart.
 *
 * @param app - Fastify instance.
 * @param apiKey - Configured `api.apiKey`, or undefined to disable auth.
 * @param logger - Optional logger; rejections log method and path only.
 */
export function registerApiKeyAuth(
  app: FastifyInstance,
  apiKey: string | undefined,
  logger?: pino.Logger,
): void {
  if (apiKey === undefined) return;
  const expectedDigest = digest(apiKey);

  app.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (isPublicRoute(request.method, request.url)) return;
      if (isAuthorized(request.headers.authorization, expectedDigest)) return;
      logger?.debug(
        { method: request.method, path: request.url.split('?', 1)[0] },
        'Rejected API request without a valid bearer token',
      );
      return reply.code(401).send(UNAUTHORIZED_BODY);
    },
  );
}
