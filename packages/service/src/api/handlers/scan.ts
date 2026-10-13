/**
 * @module api/handlers/scan
 * Fastify route handler for POST /scan. Filter-only point query without vector search.
 */

import { scanRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { VectorStore } from '../../vectorStore';
import { withFilterErrors } from '../requestError';
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the scan route handler. */
export interface ScanRouteDeps {
  /** Vector store scrolled. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
}

type ScanRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Create handler for POST /scan. A filter Qdrant rejects is
 * `400 invalid_request`.
 *
 * @param deps - Route dependencies.
 * @returns Fastify route handler.
 */
export function createScanHandler(deps: ScanRouteDeps) {
  return wrapHandler(
    async (request: ScanRequest) => {
      const body = parseBody(scanRequestSchema, request.body);
      const { filter, limit = 100, cursor, fields, countOnly } = body;

      if (countOnly) {
        const count = await withFilterErrors(deps.vectorStore.count(filter));
        return { count };
      }

      const result = await withFilterErrors(
        deps.vectorStore.scrollPage(filter, limit, cursor, fields),
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
