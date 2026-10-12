/**
 * @module api/handlers/scan
 * Fastify route handler for POST /scan. Filter-only point query without vector search.
 */

import { scanRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { VectorStore } from '../../vectorStore';
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the scan route handler. */
export interface ScanRouteDeps {
  vectorStore: VectorStore;
  logger: pino.Logger;
}

type ScanRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Create handler for POST /scan.
 *
 * @param deps - Route dependencies.
 */
export function createScanHandler(deps: ScanRouteDeps) {
  return wrapHandler(
    async (request: ScanRequest, reply: FastifyReply) => {
      const body = parseBody(scanRequestSchema, request.body, reply);
      if (!body) {
        deps.logger.warn('Scan rejected: invalid request body');
        return;
      }
      const { filter, limit = 100, cursor, fields, countOnly } = body;

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
