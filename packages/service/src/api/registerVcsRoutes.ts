/**
 * @module api/registerVcsRoutes
 * Registers the legacy git-backed versioning (VCS) routes on a Fastify instance. Only called when a VcsCoordinator is configured. GET /vcs/show is a catalog route (`api/registerCatalog`).
 */

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';

import type { VcsCoordinator } from '../vcs/VcsCoordinator';
import type { ApiServerOptions } from './apiServerOptions';
import {
  createVcsCheckExclusionHandler,
  createVcsDiffHandler,
  createVcsExcludeHandler,
  createVcsHistoryHandler,
  createVcsRevertHandler,
  createVcsStatusHandler,
} from './handlers/vcs';

/**
 * Register all VCS routes.
 *
 * @param app - Fastify instance.
 * @param options - Server options (logger).
 * @param context - The VCS coordinator backing the handlers.
 */
export function registerVcsRoutes(
  app: FastifyInstance,
  options: Pick<ApiServerOptions, 'logger'>,
  context: { coordinator: VcsCoordinator },
): void {
  const deps = { coordinator: context.coordinator, logger: options.logger };

  app.get(getEndpoint('vcsStatus').path, createVcsStatusHandler(deps));
  app.get(getEndpoint('vcsHistory').path, createVcsHistoryHandler(deps));
  app.get(getEndpoint('vcsDiff').path, createVcsDiffHandler(deps));
  app.get(
    getEndpoint('vcsCheckExclusion').path,
    createVcsCheckExclusionHandler(deps),
  );
  app.post(getEndpoint('vcsRevert').path, createVcsRevertHandler(deps));
  app.post(getEndpoint('vcsExclude').path, createVcsExcludeHandler(deps));
}
