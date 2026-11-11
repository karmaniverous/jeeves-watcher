/**
 * @module api/registerCatalog
 * Registers every `WATCHER_CATALOG` route in a child plugin, so
 * `createApiServer` stays synchronous (spec #281 D29), plus the open
 * `GET /openapi.json` route. Request validation comes from the catalog;
 * validation errors are jeeves's `400 FST_ERR_VALIDATION`. A gated entry
 * whose feature is off throws the `RouteNotFound` an unregistered route
 * throws (`api/featureGates`).
 */

import {
  registerCatalogRoutes,
  registerOpenApiRoute,
} from '@karmaniverous/jeeves/fastify';
import {
  WATCHER_CATALOG,
  WATCHER_OPENAPI_DOCUMENT,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { routeNotFound } from './apiHooks';
import { OPENAPI_PATH } from './apiKeyAuth';
import type { CreateCatalogHandlersOptions } from './catalog';
import { createCatalogHandlers } from './catalog';
import { disabledRoutes, routeKey } from './featureGates';

/** Response validation mode of the catalog routes. */
export type CatalogResponseValidation = 'log' | 'strict';

/** Options for {@link registerCatalog}. */
export interface RegisterCatalogOptions {
  /** Per-entry handler dependencies and the cache TTL. */
  handlers: CreateCatalogHandlersOptions;
  /** The watcher's logger (Fastify itself runs with `logger: false`). */
  logger: pino.Logger;
  /** What a response that doesn't match its schema does. */
  responseValidation: CatalogResponseValidation;
}

/** A `POST /config/apply` body before the catalog validates it. */
interface RawConfigApplyBody {
  patch?: unknown;
  config?: unknown;
  replace?: unknown;
}

/**
 * Normalise a `POST /config/apply` body for the catalog's
 * `{ patch, replace? }` schema: the deprecated `{ config }` alias becomes
 * `patch`, and an absent body or patch becomes `{ patch: {} }` (spec #281
 * D27). Any other body is returned unchanged for the schema to judge. Pure.
 *
 * @param body - The parsed request body, if any.
 * @returns The normalised body.
 */
export function normalizeConfigApplyBody(body: unknown): unknown {
  if (body === undefined || body === null) return { patch: {} };
  if (typeof body !== 'object' || Array.isArray(body)) return body;
  const { patch, config, ...rest } = body as RawConfigApplyBody;
  return { ...rest, patch: patch ?? config ?? {} };
}

/**
 * Register the catalog routes and `GET /openapi.json`.
 *
 * Inside the child plugin, two hooks run before a catalog handler:
 * - the feature gate (`onRequest`, after the root app's auth hook and
 *   before the body is parsed): a gated entry whose feature is off answers
 *   the exact not-found 404 an unregistered route sends, for any method
 *   and whatever the query or body (spec Design 3, D28). Version control is
 *   on exactly when the `/vcs/*` handlers have their dependencies;
 * - `preValidation`: `POST /config/apply` gets {@link normalizeConfigApplyBody},
 *   and `POST /rebuild-metadata` without a body gets `{}` (its 0.20.0 route
 *   never read the body, so a bodyless request succeeded).
 *
 * @param app - The root Fastify app (auth and error hooks already set).
 * @param options - Handler dependencies, logger and validation mode.
 */
export function registerCatalog(
  app: FastifyInstance,
  options: RegisterCatalogOptions,
): void {
  const configApplyPath = WATCHER_CATALOG.byName('configApply').path;
  const rebuildMetadataPath = WATCHER_CATALOG.byName('rebuildMetadata').path;
  const disabled = disabledRoutes(WATCHER_CATALOG.entries, {
    vcs: options.handlers.vcs !== undefined,
  });

  void app.register(async (child) => {
    child.addHook(
      'onRequest',
      (
        request: FastifyRequest,
        _reply: FastifyReply,
        done: (error?: Error) => void,
      ) => {
        const route = request.routeOptions.url ?? '';
        done(
          disabled.has(routeKey(request.method, route))
            ? routeNotFound(request)
            : undefined,
        );
      },
    );
    child.addHook(
      'preValidation',
      (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
        const route = request.routeOptions.url;
        if (request.method === 'POST' && route === configApplyPath) {
          request.body = normalizeConfigApplyBody(request.body);
        } else if (request.method === 'POST' && route === rebuildMetadataPath) {
          request.body ??= {};
        }
        done();
      },
    );

    await registerCatalogRoutes(
      child,
      WATCHER_CATALOG,
      createCatalogHandlers(options.handlers),
      {
        responseValidation: options.responseValidation,
        logger: options.logger,
      },
    );
  });

  registerOpenApiRoute(app, WATCHER_OPENAPI_DOCUMENT, { path: OPENAPI_PATH });
}
