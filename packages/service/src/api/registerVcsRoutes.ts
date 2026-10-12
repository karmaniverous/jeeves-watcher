/**
 * @module api/registerVcsRoutes
 * Registers the git-backed versioning (VCS) routes on a Fastify instance. Only called when a VcsCoordinator is configured.
 */

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import type { VcsCoordinator } from '../vcs/VcsCoordinator';
import {
  createVcsCheckExclusionHandler,
  createVcsDiffHandler,
  createVcsExcludeHandler,
  createVcsHistoryHandler,
  createVcsRevertHandler,
  createVcsShowHandler,
  createVcsStatusHandler,
} from './handlers/vcs';

/**
 * Register all VCS routes.
 *
 * @param app - Fastify instance.
 * @param coordinator - VCS coordinator backing the handlers.
 * @param logger - Logger instance.
 */
export function registerVcsRoutes(
  app: FastifyInstance,
  coordinator: VcsCoordinator,
  logger: pino.Logger,
): void {
  const deps = { coordinator, logger };

  app.get(getEndpoint('vcsStatus').path, createVcsStatusHandler(deps));
  app.get(getEndpoint('vcsHistory').path, createVcsHistoryHandler(deps));
  app.get(getEndpoint('vcsShow').path, createVcsShowHandler(deps));
  app.get(getEndpoint('vcsDiff').path, createVcsDiffHandler(deps));
  app.get(
    getEndpoint('vcsCheckExclusion').path,
    createVcsCheckExclusionHandler(deps),
  );
  app.post(getEndpoint('vcsRevert').path, createVcsRevertHandler(deps));
  app.post(getEndpoint('vcsExclude').path, createVcsExcludeHandler(deps));
}
