import { describe, expect, it, vi } from 'vitest';

import type { StatusRouteDeps } from './status';
import { createStatusHandler } from './status';

describe('createStatusHandler', () => {
  it('returns status with collection info and payload fields', async () => {
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
      payloadFields: {
        domain: { type: 'keyword' },
        content: { type: 'text' },
      },
    });
    expect(result.uptime).toBeGreaterThan(0);
  });
});
