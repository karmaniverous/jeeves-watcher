/**
 * @module api/catalog/scanHandler
 * Catalog handler for POST /scan: filter-only point query, with the
 * request already validated by the catalog's `scan` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import { SCAN_DEFAULT_LIMIT } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { VectorStore } from '../../vectorStore';
import { withFilterErrors } from '../requestError';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Dependencies for the catalog `scan` entry's handler. */
export interface CatalogScanDeps {
  /** Vector store scrolled. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
}

/**
 * Create the catalog handler for `POST /scan`. A filter Qdrant rejects is
 * `400 invalid_request` (`wrapCatalogHandler`).
 *
 * @param deps - Vector store and logger.
 * @returns The catalog handler.
 */
export function createCatalogScanHandler(
  deps: CatalogScanDeps,
): CatalogHandler<Entry<'scan'>> {
  return wrapCatalogHandler<Entry<'scan'>>(
    async (input) => {
      const {
        filter,
        limit = SCAN_DEFAULT_LIMIT,
        cursor,
        fields,
        countOnly,
      } = input.body;

      if (countOnly) {
        const count = await withFilterErrors(deps.vectorStore.count(filter));
        return { body: { count } };
      }

      const result = await withFilterErrors(
        deps.vectorStore.scrollPage(filter, limit, cursor, fields),
      );

      return {
        body: { points: result.points, cursor: result.nextCursor ?? null },
      };
    },
    deps.logger,
    'Scan',
  );
}
