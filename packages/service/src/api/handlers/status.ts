/**
 * @module api/handlers/status
 * Fastify route handler for GET /status. Returns process health, uptime, and collection stats.
 */

import type { VectorStore } from '../../vectorStore';
import type { ReindexTracker } from '../ReindexTracker';

/** Dependencies for the status route handler. */
export interface StatusRouteDeps {
  /** The vector store. */
  vectorStore: VectorStore;
  /** Vector store collection name. */
  collectionName: string;
  /** The reindex tracker. */
  reindexTracker: ReindexTracker;
}

/**
 * Create handler for GET /status.
 *
 * @param deps - Route dependencies.
 */
export function createStatusHandler(deps: StatusRouteDeps) {
  return async () => {
    const collectionInfo = await deps.vectorStore.getCollectionInfo();
    return {
      status: 'ok',
      uptime: process.uptime(),
      collection: {
        name: deps.collectionName,
        pointCount: collectionInfo.pointCount,
        dimensions: collectionInfo.dimensions,
      },
      reindex: deps.reindexTracker.getStatus(),
    };
  };
}
