/**
 * @module api/handlers/scan
 * Fastify route handler for POST /scan. Filter-only point query without vector search.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { VectorStore } from '../../vectorStore';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the scan route handler. */
export interface ScanRouteDeps {
  vectorStore: VectorStore;
  logger: pino.Logger;
}

type ScanRequest = FastifyRequest<{
  Body: {
    filter?: Record<string, unknown>;
    limit?: number;
    cursor?: string | number;
    fields?: string[];
    countOnly?: boolean;
  };
}>;

/**
 * Create handler for POST /scan.
 *
 * @param deps - Route dependencies.
 */
export function createScanHandler(deps: ScanRouteDeps) {
  return wrapHandler(
    async (request: ScanRequest, reply: FastifyReply) => {
      const { filter, limit = 100, cursor, fields, countOnly } = request.body;

      if (!filter || typeof filter !== 'object') {
        deps.logger.warn('Scan rejected: missing or invalid filter');
        void reply
          .status(400)
          .send({ error: 'Missing required field: filter (object)' });
        return;
      }

      if (typeof limit !== 'number' || limit < 1 || limit > 1000) {
        deps.logger.warn({ limit }, 'Scan rejected: limit out of bounds');
        void reply
          .status(400)
          .send({ error: 'limit must be between 1 and 1000' });
        return;
      }

      if (countOnly) {
        const count = await deps.vectorStore.count(filter);
        return { count };
      }

      const result = await deps.vectorStore.scrollPage(
        filter,
        limit,
        cursor,
        fields,
      );

      return {
        points: result.points,
        cursor: result.nextCursor ?? null,
      };
    },
    deps.logger,
    'Scan',
  );
}
