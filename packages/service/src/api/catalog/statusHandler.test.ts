/**
 * @module api/catalog/statusHandler.test
 * `createCatalogStatusSource` builds a `StatusHandler` with the same health
 * shape `GET /status` already returns, including `initialScan` when a
 * tracker is given.
 */

import { describe, expect, it } from 'vitest';

import { createCatalogStatusSource } from './statusHandler';

describe('createCatalogStatusSource', () => {
  it('reports healthy status with collection and reindex health', async () => {
    const source = createCatalogStatusSource({
      vectorStore: {
        getCollectionInfo: () =>
          Promise.resolve({ pointCount: 7, dimensions: 3 }),
      },
      getConfig: () => ({ vectorStore: { collectionName: 'watcher' } }),
      version: '1.2.3',
      reindexTracker: { getStatus: () => ({ active: false }) } as never,
    });

    const result = await source();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      name: 'watcher',
      version: '1.2.3',
      status: 'healthy',
      health: {
        collection: { name: 'watcher', pointCount: 7, dimensions: 3 },
        reindex: { active: false },
      },
    });
  });

  it('includes initialScan when a tracker is given', async () => {
    const source = createCatalogStatusSource({
      vectorStore: {
        getCollectionInfo: () =>
          Promise.resolve({ pointCount: 0, dimensions: 3 }),
      },
      getConfig: () => ({ vectorStore: { collectionName: 'watcher' } }),
      reindexTracker: { getStatus: () => ({ active: false }) } as never,
      initialScanTracker: {
        getStatus: () => ({ running: true }),
      } as never,
    });

    const result = await source();

    expect(result.body.health['initialScan']).toEqual({ running: true });
  });

  it('reports degraded status when the vector store read fails', async () => {
    const source = createCatalogStatusSource({
      vectorStore: {
        getCollectionInfo: () => Promise.reject(new Error('qdrant down')),
      },
      getConfig: () => ({ vectorStore: { collectionName: 'watcher' } }),
      reindexTracker: { getStatus: () => ({ active: false }) } as never,
    });

    const result = await source();

    expect(result.body.status).toBe('degraded');
    expect(result.body.health['error']).toBe('qdrant down');
  });
});
