import { describe, expect, it, vi } from 'vitest';

import { ReindexTracker } from '../ReindexTracker';
import type { StatusRouteDeps } from './status';
import { createStatusHandler } from './status';

describe('createStatusHandler', () => {
  it('returns status with collection info and reindex status', async () => {
    const mockDeps = {
      vectorStore: {
        getCollectionInfo: vi.fn().mockResolvedValue({
          pointCount: 42,
          dimensions: 768,
          payloadFields: {
            domain: { type: 'keyword' },
            content: { type: 'text' },
          },
        }),
      },
      config: {
        vectorStore: { collectionName: 'test-collection' },
      },
      reindexTracker: new ReindexTracker(),
    } as unknown as StatusRouteDeps;

    const handler = createStatusHandler(mockDeps);
    const result = await handler();

    expect(result).toMatchObject({
      status: 'ok',
      collection: {
        name: 'test-collection',
        pointCount: 42,
        dimensions: 768,
      },
      reindex: { active: false },
    });
    expect(result.uptime).toBeGreaterThan(0);
  });
});
