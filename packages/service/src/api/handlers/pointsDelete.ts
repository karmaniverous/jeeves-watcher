/**
 * @module api/handlers/pointsDelete
 * Fastify route handler for POST /points/delete.
 */

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { VectorStore } from '../../vectorStore';
import { wrapHandler } from './wrapHandler';

export interface PointsDeleteDeps {
  vectorStore: VectorStore;
  logger: pino.Logger;
}

type PointsDeleteRequest = FastifyRequest<{
  Body: { filter: Record<string, unknown> };
}>;

/**
 * Create handler for POST /points/delete.
 * Deletes points matching a Qdrant filter.
 */
export function createPointsDeleteHandler(deps: PointsDeleteDeps) {
  return wrapHandler(
    async (request: PointsDeleteRequest) => {
      const { filter } = request.body;

      if (typeof filter !== 'object') {
        throw new Error('Missing required field: filter (object)');
      }

      // Collect matching point IDs via scroll
      const ids: string[] = [];
      for await (const point of deps.vectorStore.scroll(filter, 100)) {
        ids.push(point.id);
      }

      if (ids.length > 0) {
        await deps.vectorStore.delete(ids);
      }

      deps.logger.info(
        { filter, deleted: ids.length },
        'Points deleted by filter',
      );

      return { deleted: ids.length };
    },
    deps.logger,
    'PointsDelete',
  );
}
