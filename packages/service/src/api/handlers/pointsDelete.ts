/**
 * @module api/handlers/pointsDelete
 * Fastify route handler for POST /points/delete.
 */

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { VectorStore } from '../../vectorStore';
import { invalidRequest, withFilterErrors } from '../requestError';
import { wrapHandler } from './wrapHandler';

/** Dependencies of the POST /points/delete handler. */
export interface PointsDeleteDeps {
  /** Vector store the points are deleted from. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
}

type PointsDeleteRequest = FastifyRequest<{
  Body: { filter?: unknown } | undefined;
}>;

/** Whether a value is a plain object. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Collect the IDs of every point matching a filter (a Qdrant rejection of
 * the filter becomes `400 invalid_request`).
 */
async function matchingIds(
  vectorStore: VectorStore,
  filter: Record<string, unknown>,
): Promise<string[]> {
  const ids: string[] = [];
  for await (const point of vectorStore.scroll(filter, 100)) {
    ids.push(point.id);
  }
  return ids;
}

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
      const filter = request.body?.filter;

      if (!isPlainObject(filter)) {
        throw invalidRequest('Missing required field: filter (object)');
      }

      const ids = await withFilterErrors(matchingIds(deps.vectorStore, filter));

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
