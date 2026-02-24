/**
 * @module api/handlers/status
 * Fastify route handler for GET /status. Returns process health, uptime, and collection stats.
 */

import type { JeevesWatcherConfig } from '../../config/types';
import type { VectorStore } from '../../vectorStore';
import type { ReindexTracker } from '../ReindexTracker';

/** Dependencies for the status route handler. */
export interface StatusRouteDeps {
  /** The vector store. */
  vectorStore: VectorStore;
  /** The application configuration. */
  config: JeevesWatcherConfig;
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
        name: deps.config.vectorStore.collectionName,
        pointCount: collectionInfo.pointCount,
        dimensions: collectionInfo.dimensions,
      },
      reindex: deps.reindexTracker.getStatus(),
    };
  };
}
