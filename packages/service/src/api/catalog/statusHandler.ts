/**
 * @module api/catalog/statusHandler
 * `StatusHandler` source for the catalog `status` entry: the same health
 * details `GET /status` already returns, built once and fitted to the
 * catalog by `standardHandlers` (`@karmaniverous/jeeves/fastify`) alongside
 * `config` and `configApply` (`api/catalog/index`).
 */

import { createStatusHandler, type StatusHandler } from '@karmaniverous/jeeves';

import type { InitialScanTracker } from '../InitialScanTracker';
import type { ReindexTracker } from '../ReindexTracker';

/** A vector store's collection-info read, as `status` needs it. */
export interface CatalogStatusVectorStore {
  /** Read the collection's point count and dimensions. */
  getCollectionInfo: () => Promise<{
    pointCount: number;
    dimensions: number;
  }>;
}

/** Dependencies for the catalog `status` entry's source handler. */
export interface CatalogStatusDeps {
  /** Vector store, for collection health. */
  vectorStore: CatalogStatusVectorStore;
  /** Live config getter (for the collection name). */
  getConfig: () => { vectorStore: { collectionName: string } };
  /** Service version string. */
  version?: string;
  /** Reindex progress tracker. */
  reindexTracker: ReindexTracker;
  /** Initial scan tracker, when the service runs one. */
  initialScanTracker?: InitialScanTracker;
}

/**
 * Build the `StatusHandler` source for `GET /status`.
 *
 * @param deps - Vector store, live config, version and trackers.
 * @returns A `StatusHandler`, ready for `standardHandlers`.
 */
export function createCatalogStatusSource(
  deps: CatalogStatusDeps,
): StatusHandler {
  return createStatusHandler({
    name: 'watcher',
    version: deps.version ?? 'unknown',
    getHealth: async () => {
      const collectionInfo = await deps.vectorStore.getCollectionInfo();
      return {
        collection: {
          name: deps.getConfig().vectorStore.collectionName,
          pointCount: collectionInfo.pointCount,
          dimensions: collectionInfo.dimensions,
        },
        reindex: deps.reindexTracker.getStatus(),
        ...(deps.initialScanTracker
          ? { initialScan: deps.initialScanTracker.getStatus() }
          : {}),
      };
    },
  });
}
