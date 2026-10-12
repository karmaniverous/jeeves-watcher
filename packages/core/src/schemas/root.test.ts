/**
 * @module schemas/root.test
 * Tests for the 0.20.0 additions to the root config schema (api.apiKey, sources, payloadIndexes).
 */

import { describe, expect, it } from 'vitest';

import { jeevesWatcherConfigSchema } from './root';

const minimal = {
  watch: { paths: ['**/*.md'] },
  embedding: { provider: 'mock' },
  vectorStore: { url: 'http://localhost:6333', collectionName: 'c' },
  api: { host: '127.0.0.1', port: 1936 },
};

describe('jeevesWatcherConfigSchema 0.20.0 additions', () => {
  it('validates an existing config unchanged (no new keys added)', () => {
    const parsed = jeevesWatcherConfigSchema.parse(minimal);
    expect(parsed.sources).toBeUndefined();
    expect(parsed.api).toEqual({ host: '127.0.0.1', port: 1936 });
    expect(parsed.vectorStore).toEqual(minimal.vectorStore);
  });

  it('accepts api.apiKey, sources and payloadIndexes together', () => {
    const parsed = jeevesWatcherConfigSchema.parse({
      ...minimal,
      api: { ...minimal.api, apiKey: '${WATCHER_API_KEY}' },
      vectorStore: {
        ...minimal.vectorStore,
        payloadIndexes: [{ field: 'user_id', type: 'keyword', isTenant: true }],
      },
      sources: {
        cg: {
          url: '${CG_SOURCE_BASE_URL}/watcher/sources/{id}',
          headers: { Authorization: 'Bearer ${CG_SOURCE_KEY}' },
        },
      },
    });
    expect(parsed.api?.apiKey).toBe('${WATCHER_API_KEY}');
    expect(parsed.sources?.['cg'].concurrency).toBe(8);
    expect(parsed.vectorStore.payloadIndexes?.[0].isTenant).toBe(true);
  });

  it('rejects a non-string api.apiKey', () => {
    const result = jeevesWatcherConfigSchema.safeParse({
      ...minimal,
      api: { apiKey: 123 },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['api', 'apiKey']);
  });

  it('rejects an invalid source name with a path into sources', () => {
    const result = jeevesWatcherConfigSchema.safeParse({
      ...minimal,
      sources: { X: { url: 'http://x/{id}' } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path[0]).toBe('sources');
  });
});
