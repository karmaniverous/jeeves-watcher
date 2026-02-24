import { describe, expect, it, vi } from 'vitest';

import type { VectorStore } from '../../vectorStore';
import { ReindexTracker } from '../ReindexTracker';
import { createStatusHandler } from './status';

describe('createStatusHandler', () => {
  it('returns status with collection info and reindex status', async () => {
    const vectorStore: Partial<VectorStore> = {
      getCollectionInfo: vi.fn().mockResolvedValue({
        pointCount: 42,
        dimensions: 768,
        payloadFields: {
          domain: { type: 'keyword' },
          content: { type: 'text' },
        },
      }),
    };

    const mockDeps = {
      vectorStore: vectorStore as VectorStore,
      collectionName: 'test-collection',
      reindexTracker: new ReindexTracker(),
    };

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
