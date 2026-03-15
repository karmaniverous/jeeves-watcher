/**
 * @module api/handlers/status
 * Fastify route handler for GET /status. Returns process health, uptime, and collection stats.
 */

import type { VectorStore } from '../../vectorStore';
import type { InitialScanTracker } from '../InitialScanTracker';
import type { ReindexTracker } from '../ReindexTracker';

/** Dependencies for the status route handler. */
export interface StatusRouteDeps {
  /** The vector store. */
  vectorStore: VectorStore;
  /** Vector store collection name. */
  collectionName: string;
  /** The reindex tracker. */
  reindexTracker: ReindexTracker;
  /** Service version string. */
  version: string;
  /** Initial scan tracker (optional). */
  initialScanTracker?: InitialScanTracker;
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
      version: deps.version,
      uptime: process.uptime(),
      collection: {
        name: deps.collectionName,
        pointCount: collectionInfo.pointCount,
        dimensions: collectionInfo.dimensions,
      },
      reindex: deps.reindexTracker.getStatus(),
      ...(deps.initialScanTracker
        ? { initialScan: deps.initialScanTracker.getStatus() }
        : {}),
    };
  };
}
