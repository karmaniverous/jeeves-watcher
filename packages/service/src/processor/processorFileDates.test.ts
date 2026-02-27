import pino from 'pino';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor, type ProcessorConfig } from './index';

// Mock buildMergedMetadata so we don't touch the filesystem
vi.mock('./buildMetadata', () => ({
  buildMergedMetadata: vi.fn(),
}));

// Mock metadata I/O
vi.mock('../metadata', () => ({
  readMetadata: vi.fn(),
  writeMetadata: vi.fn(),
  deleteMetadata: vi.fn(),
}));

// Mock node:fs/promises stat() to return predictable values
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  stat: vi.fn().mockResolvedValue({
    birthtimeMs: 1700000000000,
    mtimeMs: 1700100000000,
  }),
}));

import { buildMergedMetadata } from './buildMetadata';

const mockedBuildMergedMetadata = buildMergedMetadata as Mock;

interface MockVectorStore {
  getPayload: Mock;
  upsert: Mock;
  delete: Mock;
  setPayload: Mock;
}

describe('DocumentProcessor file date & line offset fields', () => {
  let vectorStore: MockVectorStore;
  let embeddingProvider: EmbeddingProvider;
  let processor: DocumentProcessor;

  beforeEach(() => {
    vi.clearAllMocks();

    vectorStore = {
      getPayload: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      setPayload: vi.fn().mockResolvedValue(undefined),
    };

    embeddingProvider = {
      dimensions: 3,
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    const config: ProcessorConfig = {
      metadataDir: '/tmp/meta',
      chunkSize: 1000,
      chunkOverlap: 200,
    };

    processor = new DocumentProcessor({
      config,
      embeddingProvider,
      vectorStore: vectorStore as unknown as VectorStoreClient,
      compiledRules: [],
      logger: pino({ level: 'silent' }),
    });
  });

  it('includes created_at, modified_at, line_start, line_end in upserted points', async () => {
    mockedBuildMergedMetadata.mockResolvedValue({
      metadata: { domain: 'test' },
      extracted: { text: 'line1\nline2\nline3', frontmatter: null, json: null },
      renderedContent: null,
      matchedRules: ['rule1'],
      inferred: { domain: 'test' },
      enrichment: null,
      attributes: {},
    });

    await processor.processFile('/test.txt');

    expect(vectorStore.upsert).toHaveBeenCalledOnce();
    const points = vectorStore.upsert.mock.calls[0][0] as Array<{
      payload: Record<string, unknown>;
    }>;
    expect(points.length).toBeGreaterThan(0);

    const payload = points[0].payload;
    expect(payload['created_at']).toBe(1700000000);
    expect(payload['modified_at']).toBe(1700100000);
    expect(payload['line_start']).toBe(1);
    expect(payload['line_end']).toBe(3);
  });
});
