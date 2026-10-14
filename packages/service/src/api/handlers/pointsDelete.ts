/**
 * @module api/handlers/pointsDelete
 * Fastify route handler for POST /points/delete.
 */

import { pointsDeleteRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { VectorStore } from '../../vectorStore';
import { deletePointsByFilter } from '../pointDeletion';
import { withFilterErrors } from '../requestError';
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

/** Dependencies of the POST /points/delete handler. */
export interface PointsDeleteDeps {
  /** Vector store the points are deleted from. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
}

type PointsDeleteRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Create handler for POST /points/delete.
 * Deletes points matching a Qdrant filter. A missing or non-object `filter`,
 * or one Qdrant rejects, is `400 invalid_request`.
 *
 * @param deps - Handler dependencies.
 * @returns Fastify route handler.
 */
export function createPointsDeleteHandler(deps: PointsDeleteDeps) {
  return wrapHandler(
    async (request: PointsDeleteRequest) => {
      const { filter } = parseBody(
        pointsDeleteRequestSchema,
        request.body ?? {},
      );

      const deleted = await withFilterErrors(
        deletePointsByFilter(deps.vectorStore, filter),
      );

      deps.logger.info(
        { filter, deleted: deleted.length },
        'Points deleted by filter',
      );

      return { deleted: deleted.length };
    },
    deps.logger,
    'PointsDelete',
  );
}
