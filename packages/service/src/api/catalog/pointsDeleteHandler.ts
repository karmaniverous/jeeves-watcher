/**
 * @module api/catalog/pointsDeleteHandler
 * Catalog handler for `POST /points/delete`: deletes the points matching a Qdrant filter. The request (`filter`) is validated by the catalog's `pointsDelete` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import type pino from 'pino';

import type { VectorStore } from '../../vectorStore';
import { deletePointsByFilter } from '../pointDeletion';
import { withFilterErrors } from '../requestError';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Dependencies for the catalog `pointsDelete` entry's handler. */
export interface CatalogPointsDeleteDeps {
  /** Vector store the points are deleted from. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
}

/**
 * Create the catalog handler for `POST /points/delete`. A filter Qdrant
 * rejects is `400 invalid_request`.
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogPointsDeleteHandler(
  deps: CatalogPointsDeleteDeps,
): CatalogHandler<Entry<'pointsDelete'>> {
  return wrapCatalogHandler<Entry<'pointsDelete'>>(
    async (input) => {
      const { filter } = input.body;

      const deleted = await withFilterErrors(
        deletePointsByFilter(deps.vectorStore, filter),
      );

      deps.logger.info(
        { filter, deleted: deleted.length },
        'Points deleted by filter',
      );

      return { body: { deleted: deleted.length } };
    },
    deps.logger,
    'PointsDelete',
  );
}
