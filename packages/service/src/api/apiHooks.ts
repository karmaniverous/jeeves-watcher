/**
 * @module api/apiHooks
 * Server-wide Fastify hooks: API-key auth (`Unauthorized`), a not-found handler that throws `RouteNotFound` (the same 404 a gated route answers, D28, D50) and jeeves's error handler (`registerErrorHandlers`) for the routes outside the catalog scope, logging 5xx causes through the watcher's logger.
 */

import { registerErrorHandlers } from '@karmaniverous/jeeves/fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { registerApiKeyAuth } from './apiKeyAuth';
import { capArg, RouteNotFound } from './errors';

/**
 * The `RouteNotFound` error for a request: the caller's own method and URL,
 * capped. Shared by the not-found handler and the feature gate, so an
 * unknown route and a gated route answer byte for byte alike. Pure.
 *
 * @param request - The request (method and URL).
 * @returns The error to throw.
 */
export function routeNotFound(request: Pick<FastifyRequest, 'method' | 'url'>) {
  return new RouteNotFound(capArg(request.method), capArg(request.url));
}

/**
 * Register every server-wide hook: API-key auth (no-op without a key), the
 * not-found handler and jeeves's error handler. Must be called before
 * routes.
 *
 * @param app - Fastify instance.
 * @param apiKey - Configured `api.apiKey`, or undefined to disable auth.
 * @param logger - The watcher's logger (Fastify runs with `logger: false`).
 */
export function registerApiHooks(
  app: FastifyInstance,
  apiKey: string | undefined,
  logger: pino.Logger,
): void {
  registerApiKeyAuth(app, apiKey, logger);
  registerErrorHandlers(app, { logger });
  app.setNotFoundHandler((request) => {
    throw routeNotFound(request);
  });
}
