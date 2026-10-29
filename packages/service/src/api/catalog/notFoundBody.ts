/**
 * @module api/catalog/notFoundBody
 * The exact 404 body Fastify's own not-found handler sends today
 * (`apiHooks`' `setNotFoundHandler`), for a catalog handler that must answer
 * the same way when its route condition isn't met even though the route is
 * registered (e.g. `GET /vcs/show` with no VCS coordinator configured;
 * spec #281 D28). Pure.
 */

import type { ApiErrorBody } from '@karmaniverous/jeeves-watcher-core';

/**
 * Build the `404 not_found` body `apiHooks`' not-found handler sends for an
 * unmatched route.
 *
 * @param method - HTTP method of the request.
 * @param url - Request URL (path plus query string), as Fastify received it.
 * @returns `{ code: 'not_found', error: 'Not Found', message }`.
 */
export function notFoundBody(method: string, url: string): ApiErrorBody {
  return {
    code: 'not_found',
    error: 'Not Found',
    message: `Route ${method}:${url} not found`,
  };
}
