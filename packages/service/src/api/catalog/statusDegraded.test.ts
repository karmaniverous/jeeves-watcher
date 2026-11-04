/**
 * @module api/catalog/statusDegraded.test
 * GET /status degraded (D88): status is degraded, with HTTP 200, when embeddings are failing or a VCS breaker is tripped; healthy otherwise; health.embedding carries codes and timestamps only (no error message or path).
 */

import { describe, expect, it } from 'vitest';

import { ReindexTracker } from '../ReindexTracker';
import {
  createCatalogStatusSource,
  isDegraded,
  withDegradedStatus,
} from './statusHandler';

const okEmbedding = {
  state: 'ok' as const,
  lastSuccessAt: '2026-11-04T00:00:00.000Z',
  lastError: null,
  failingSince: null,
  backoffUntil: null,
};
const vcs = (trippedRoots: number) => ({
  roots: 1,
  pending: 0,
  trippedRoots,
  oldestTrippedAt: trippedRoots > 0 ? '2026-11-04T00:00:00.000Z' : null,
});

function source(deps: {
  embedding?: Parameters<typeof isDegraded>[0];
  trippedRoots?: number;
}) {
  return createCatalogStatusSource({
    vectorStore: {
      getCollectionInfo: () =>
        Promise.resolve({ pointCount: 1, dimensions: 3 }),
    },
    getConfig: () => ({ vectorStore: { collectionName: 'c' } }),
    version: '0.21.0',
    reindexTracker: new ReindexTracker(),
    ...(deps.embedding
      ? { getEmbeddingHealth: () => deps.embedding as never }
      : {}),
    ...(deps.trippedRoots === undefined
      ? {}
      : { getVcsHealth: () => vcs(deps.trippedRoots ?? 0) }),
  });
}

describe('GET /status degraded (D88)', () => {
  it('is healthy when embeddings are ok and no breaker is tripped', async () => {
    const result = await source({ embedding: okEmbedding, trippedRoots: 0 })();
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('healthy');
    expect(result.body.health.embedding).toEqual(okEmbedding);
  });

  it('is degraded with HTTP 200 while embeddings are failing', async () => {
    const failing = {
      ...okEmbedding,
      state: 'failing' as const,
      lastError: { at: '2026-11-04T00:02:00.000Z', code: 'http_503' },
      failingSince: '2026-11-04T00:02:00.000Z',
    };
    const result = await source({ embedding: failing })();
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('degraded');
    const text = JSON.stringify(result.body.health.embedding);
    expect(text).not.toMatch(/message|path/u);
  });

  it('is degraded with HTTP 200 while a VCS breaker is tripped', async () => {
    const result = await source({ embedding: okEmbedding, trippedRoots: 1 })();
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('degraded');
  });

  it('isDegraded ignores absent sections', () => {
    expect(isDegraded({})).toBe(false);
    expect(isDegraded({ vcs: { trippedRoots: 'x' } })).toBe(false);
  });

  it('leaves a non-healthy status alone', async () => {
    const wrapped = withDegradedStatus(() =>
      Promise.resolve({
        status: 503,
        body: {
          name: 'watcher',
          version: '1',
          uptime: 1,
          status: 'unhealthy' as const,
          health: { embedding: { state: 'failing' } },
        },
      }),
    );
    const result = await wrapped();
    expect(result.status).toBe(503);
    expect(result.body.status).toBe('unhealthy');
  });
});
