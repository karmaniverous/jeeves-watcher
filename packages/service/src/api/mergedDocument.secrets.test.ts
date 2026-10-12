/**
 * @module api/mergedDocument.secrets.test
 * Tests that GET /config's merged document never exposes `sources` or `api` (API key).
 */

import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import type { IssuesManager } from '../issues';
import type { ValuesManager } from '../values';
import { buildMergedDocument } from './mergedDocument';

describe('buildMergedDocument secret exclusion', () => {
  it('omits sources and api from the merged document', () => {
    const doc = buildMergedDocument({
      config: {
        watch: { paths: ['**/*.md'] },
        embedding: { provider: 'mock' },
        vectorStore: { url: 'http://localhost:6333', collectionName: 'c' },
        api: { apiKey: 'top-secret-key' },
        sources: {
          cg: {
            url: 'http://x/{id}',
            headers: { Authorization: 'Bearer top-secret-token' },
            timeoutMs: 10000,
            concurrency: 8,
          },
        },
      } as unknown as JeevesWatcherConfig,
      valuesManager: {
        getForRule: vi.fn().mockReturnValue({}),
      } as unknown as ValuesManager,
      issuesManager: {
        getAll: vi.fn().mockReturnValue({}),
      } as unknown as IssuesManager,
    });

    expect(doc).not.toHaveProperty('sources');
    expect(doc).not.toHaveProperty('api');
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain('top-secret');
  });
});
