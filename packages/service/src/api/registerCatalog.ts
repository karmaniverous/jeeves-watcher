/**
 * @module api/registerCatalog
 * Registers the `WATCHER_CATALOG` routes (status, config, config apply,
 * render, search, scan, vcs/show) in a child plugin, so `createApiServer`
 * stays synchronous (spec #281 D29), plus the open `GET /openapi.json`
 * route. Request validation comes from the catalog; validation errors are
 * `400 invalid_request` (`formatValidationError`).
 */

import {
  type CatalogValidationIssue,
  registerCatalogRoutes,
  registerOpenApiRoute,
} from '@karmaniverous/jeeves/fastify';
import {
  getEndpoint,
  WATCHER_CATALOG,
  WATCHER_OPENAPI_DOCUMENT,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { OPENAPI_PATH } from './apiKeyAuth';
import type { CreateCatalogHandlersOptions } from './catalog';
import { createCatalogHandlers } from './catalog';
import { notFoundBody } from './catalog/notFoundBody';

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

/**
 * The `400 invalid_request` body for a request the catalog rejects: the
 * first issue's message as `error`, every issue as `details`. Pure.
 *
 * @param issues - Validation issues (never empty).
 * @returns The error body.
 */
export function formatValidationError(issues: CatalogValidationIssue[]): {
  code: 'invalid_request';
  error: string;
  details: CatalogValidationIssue[];
} {
  return {
    code: 'invalid_request',
    error: issues[0]?.message ?? 'Invalid request',
    details: issues,
  };
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
 * Inside the child plugin, one `preValidation` hook runs before the
 * catalog validates a request:
 * - `POST /config/apply` gets {@link normalizeConfigApplyBody};
 * - with VCS disabled, `GET /vcs/show` (and the `HEAD` route Fastify
 *   derives from it) answers the exact not-found body an unregistered route
 *   sends, whatever its query (spec #281 D28).
 *
 * @param app - The root Fastify app (auth and error hooks already set).
 * @param options - Handler dependencies, logger and validation mode.
 */
export function registerCatalog(
  app: FastifyInstance,
  options: RegisterCatalogOptions,
): void {
  const configApplyPath = getEndpoint('configApply').path;
  const vcsShowPath = getEndpoint('vcsShow').path;
  const vcsEnabled = options.handlers.vcsShow.coordinator !== undefined;

  void app.register(async (child) => {
    child.addHook(
      'preValidation',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const route = request.routeOptions.url;
        if (request.method === 'POST' && route === configApplyPath) {
          request.body = normalizeConfigApplyBody(request.body);
          return;
        }
        if (
          !vcsEnabled &&
          (request.method === 'GET' || request.method === 'HEAD') &&
          route === vcsShowPath
        ) {
          return reply
            .status(404)
            .send(notFoundBody(request.method, request.url));
        }
      },
    );

    await registerCatalogRoutes(
      child,
      WATCHER_CATALOG,
      createCatalogHandlers(options.handlers),
      {
        formatValidationError,
        responseValidation: options.responseValidation,
        logger: options.logger,
      },
    );
  });

  registerOpenApiRoute(app, WATCHER_OPENAPI_DOCUMENT, { path: OPENAPI_PATH });
}
