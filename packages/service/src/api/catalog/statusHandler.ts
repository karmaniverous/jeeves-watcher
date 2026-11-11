/**
 * @module api/catalog/statusHandler
 * `StatusHandler` source for the catalog `status` entry: the same health
 * details `GET /status` already returns, built once and fitted to the
 * catalog by `standardHandlers` (`@karmaniverous/jeeves/fastify`) alongside
 * `config` and `configApply` (`api/catalog/index`).
 */

import { createStatusHandler, type StatusHandler } from '@karmaniverous/jeeves';
import type {
  ChangeSourceHealth,
  EmbeddingHealth,
  IndexCheckHealth,
  SystemIndexes,
  VcsHealth,
} from '@karmaniverous/jeeves-watcher-core';

import type { InitialScanTracker } from '../InitialScanTracker';
import type { ReindexTracker } from '../ReindexTracker';

/** A vector store's collection-info read, as `status` needs it. */
export interface CatalogStatusVectorStore {
  /** Read the collection's point count and dimensions. */
  getCollectionInfo: () => Promise<{
    pointCount: number;
    dimensions: number;
  }>;
  /** System payload index states (D74, D154), when the store tracks them. */
  systemIndexStates?: () => SystemIndexes;
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
  /** VCS health (`health.vcs`, D86), when any root has VCS enabled. */
  getVcsHealth?: () => VcsHealth;
  /** Embedding health (`health.embedding`, D88, D89). */
  getEmbeddingHealth?: () => EmbeddingHealth;
  /** Change-source health (`health.changeSource`, D133, D157). */
  getChangeSourceHealth?: () => ChangeSourceHealth;
  /** Index check at start (`health.indexCheck`, D197). */
  getIndexCheckHealth?: () => IndexCheckHealth;
}

/**
 * Whether a status body is `degraded` (D86): embeddings failing, or any VCS
 * circuit breaker tripped. Pure.
 *
 * @param health - The status body's `health`.
 * @returns True when the service is degraded.
 */
export function isDegraded(health: Record<string, unknown>): boolean {
  const embedding = health.embedding as { state?: unknown } | undefined;
  const vcs = health.vcs as { trippedRoots?: unknown } | undefined;
  return (
    embedding?.state === 'failing' ||
    (typeof vcs?.trippedRoots === 'number' && vcs.trippedRoots > 0)
  );
}

/**
 * Wrap a status handler so a degraded service reports
 * `status: 'degraded'` (D86). The HTTP status is unchanged (200).
 *
 * @param handler - The inner status handler.
 * @returns The wrapped handler.
 */
export function withDegradedStatus(handler: StatusHandler): StatusHandler {
  return async (logger) => {
    const result = await handler(logger);
    const { body } = result;
    if (body.status === 'healthy' && isDegraded(body.health)) {
      return { ...result, body: { ...body, status: 'degraded' } };
    }
    return result;
  };
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
  return withDegradedStatus(statusSource(deps));
}

/** The undecorated status handler. */
function statusSource(deps: CatalogStatusDeps): StatusHandler {
  return createStatusHandler({
    name: 'watcher',
    version: deps.version ?? 'unknown',
    getHealth: async () => {
      const { vectorStore } = deps;
      const collectionInfo = await vectorStore.getCollectionInfo();
      return {
        collection: {
          name: deps.getConfig().vectorStore.collectionName,
          pointCount: collectionInfo.pointCount,
          dimensions: collectionInfo.dimensions,
          ...(vectorStore.systemIndexStates
            ? { systemIndexes: vectorStore.systemIndexStates() }
            : {}),
        },
        reindex: deps.reindexTracker.getStatus(),
        ...(deps.initialScanTracker
          ? { initialScan: deps.initialScanTracker.getStatus() }
          : {}),
        ...(deps.getVcsHealth ? { vcs: deps.getVcsHealth() } : {}),
        ...(deps.getEmbeddingHealth
          ? { embedding: deps.getEmbeddingHealth() }
          : {}),
        ...(deps.getChangeSourceHealth
          ? { changeSource: deps.getChangeSourceHealth() }
          : {}),
        ...(deps.getIndexCheckHealth
          ? { indexCheck: deps.getIndexCheckHealth() }
          : {}),
      };
    },
  });
}
