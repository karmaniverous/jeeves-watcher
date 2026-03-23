/**
 * @module processor/moveFile.test
 * Tests for DocumentProcessor.moveFile.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
import type { EnrichmentStoreInterface } from '../enrichment';
import type { IssuesManager } from '../issues';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor, type ProcessorConfig } from './index';

// Mock buildMergedMetadata so we don't touch the filesystem
vi.mock('./buildMetadata', () => ({
  buildMergedMetadata: vi.fn(),
}));

// Mock node:fs/promises readFile for fileHash
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  readFile: vi.fn().mockResolvedValue(Buffer.from('mock')),
}));

import { buildMergedMetadata } from './buildMetadata';

const mockedBuildMergedMetadata = buildMergedMetadata as Mock;

interface MockVectorStore {
  getPayload: Mock;
  upsert: Mock;
  delete: Mock;
  setPayload: Mock;
  getPointsWithVectors: Mock;
}

interface MockEnrichmentStore {
  get: Mock;
  set: Mock;
  delete: Mock;
  move: Mock;
  list: Mock;
  close: Mock;
}

interface MockIssuesManager {
  record: Mock;
  clear: Mock;
}

interface MockValuesManager {
  update: Mock;
}

function createMocks() {
  const vectorStore: MockVectorStore = {
    getPayload: vi.fn().mockResolvedValue({ total_chunks: 2 }),
    upsert: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    setPayload: vi.fn().mockResolvedValue(undefined),
    getPointsWithVectors: vi.fn().mockResolvedValue([
      {
        id: 'old-id-0',
        vector: [0.1, 0.2, 0.3],
        payload: {
          file_path: '/old.txt',
          chunk_index: 0,
          total_chunks: 2,
          content_hash: 'abc',
          chunk_text: 'hello',
        },
      },
      {
        id: 'old-id-1',
        vector: [0.4, 0.5, 0.6],
        payload: {
          file_path: '/old.txt',
          chunk_index: 1,
          total_chunks: 2,
          content_hash: 'abc',
          chunk_text: 'world',
        },
      },
    ]),
  };

  const enrichmentStore: MockEnrichmentStore = {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  };

  const issuesManager: MockIssuesManager = {
    record: vi.fn(),
    clear: vi.fn(),
  };

  const valuesManager: MockValuesManager = {
    update: vi.fn(),
  };

  const embeddingProvider: EmbeddingProvider = {
    dimensions: 3,
    embed: vi.fn(),
  };

  const config: ProcessorConfig = {};
  const logger = pino({ level: 'silent' });

  return {
    vectorStore,
    enrichmentStore,
    issuesManager,
    valuesManager,
    embeddingProvider,
    config,
    logger,
  };
}

function defaultMergedMetadata() {
  return {
    metadata: { domain: 'test' },
    extracted: { text: 'hello world', frontmatter: null, json: null },
    renderedContent: null,
    matchedRules: ['rule1'],
    inferred: { domain: 'test' },
    enrichment: null,
    attributes: {},
  };
}

describe('DocumentProcessor.moveFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedBuildMergedMetadata.mockResolvedValue(defaultMergedMetadata());
  });

  it('upserts new points and deletes old points', async () => {
    const { vectorStore, embeddingProvider, config, logger } = createMocks();

    const processor = new DocumentProcessor({
      config,
      embeddingProvider,
      vectorStore: vectorStore as unknown as VectorStoreClient,
      compiledRules: [],
      logger,
    });
    await processor.moveFile('/old.txt', '/new.txt');

    // Upsert called with 2 new points
    expect(vectorStore.upsert).toHaveBeenCalledOnce();
    const newPoints = vectorStore.upsert.mock.calls[0][0] as Array<{
      payload: Record<string, unknown>;
      vector: number[];
    }>;
    expect(newPoints).toHaveLength(2);
    expect(newPoints[0].payload['file_path']).toBe('/new.txt');
    expect(newPoints[1].payload['file_path']).toBe('/new.txt');
    // Vectors preserved
    expect(newPoints[0].vector).toEqual([0.1, 0.2, 0.3]);
    expect(newPoints[1].vector).toEqual([0.4, 0.5, 0.6]);

    // Old points deleted
    expect(vectorStore.delete).toHaveBeenCalledOnce();
    const deletedIds = vectorStore.delete.mock.calls[0][0] as string[];
    expect(deletedIds).toHaveLength(2);
  });

  it('moves enrichment and clears issues', async () => {
    const {
      vectorStore,
      enrichmentStore,
      issuesManager,
      embeddingProvider,
      config,
      logger,
    } = createMocks();

    const processor = new DocumentProcessor({
      config,
      embeddingProvider,
      vectorStore: vectorStore as unknown as VectorStoreClient,
      compiledRules: [],
      logger,
      enrichmentStore: enrichmentStore as unknown as EnrichmentStoreInterface,
      issuesManager: issuesManager as unknown as IssuesManager,
    });
    await processor.moveFile('/old.txt', '/new.txt');

    expect(enrichmentStore.move).toHaveBeenCalledWith('/old.txt', '/new.txt');
    expect(issuesManager.clear).toHaveBeenCalledWith('/old.txt');
  });

  it('updates values for matched rules', async () => {
    const { vectorStore, valuesManager, embeddingProvider, config, logger } =
      createMocks();

    const processor = new DocumentProcessor({
      config,
      embeddingProvider,
      vectorStore: vectorStore as unknown as VectorStoreClient,
      compiledRules: [],
      logger,
      valuesManager: valuesManager as unknown as ValuesManager,
    });
    await processor.moveFile('/old.txt', '/new.txt');

    expect(valuesManager.update).toHaveBeenCalledWith(
      'rule1',
      expect.objectContaining({ domain: 'test' }),
    );
  });

  it('applies new metadata from inference rules', async () => {
    const { vectorStore, embeddingProvider, config, logger } = createMocks();
    mockedBuildMergedMetadata.mockResolvedValue({
      ...defaultMergedMetadata(),
      metadata: { domain: 'new-domain', category: 'docs' },
    });

    const processor = new DocumentProcessor({
      config,
      embeddingProvider,
      vectorStore: vectorStore as unknown as VectorStoreClient,
      compiledRules: [],
      logger,
    });
    await processor.moveFile('/old.txt', '/new.txt');

    const newPoints = vectorStore.upsert.mock.calls[0][0] as Array<{
      payload: Record<string, unknown>;
    }>;
    expect(newPoints[0].payload['domain']).toBe('new-domain');
    expect(newPoints[0].payload['category']).toBe('docs');
  });

  it('handles no existing points gracefully', async () => {
    const { vectorStore, embeddingProvider, config, logger } = createMocks();
    vectorStore.getPointsWithVectors.mockResolvedValue([]);

    const processor = new DocumentProcessor({
      config,
      embeddingProvider,
      vectorStore: vectorStore as unknown as VectorStoreClient,
      compiledRules: [],
      logger,
    });
    await processor.moveFile('/old.txt', '/new.txt');

    expect(vectorStore.upsert).not.toHaveBeenCalled();
    expect(vectorStore.delete).not.toHaveBeenCalled();
  });

  it('updates content hash cache on move', async () => {
    const { vectorStore, embeddingProvider, config, logger } = createMocks();

    const contentHashCache = {
      get: vi.fn().mockReturnValue('hash123'),
      set: vi.fn(),
      delete: vi.fn(),
    };

    const processor = new DocumentProcessor({
      config,
      embeddingProvider,
      vectorStore: vectorStore as unknown as VectorStoreClient,
      compiledRules: [],
      logger,
      contentHashCache: contentHashCache as never,
    });
    await processor.moveFile('/old.txt', '/new.txt');

    expect(contentHashCache.get).toHaveBeenCalledWith('/old.txt');
    expect(contentHashCache.set).toHaveBeenCalledWith('/new.txt', 'hash123');
    expect(contentHashCache.delete).toHaveBeenCalledWith('/old.txt');
  });
});
