import pino from 'pino';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
import type { IssuesManager } from '../issues';
import type { ValuesManager } from '../values';
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
  ...(await importOriginal()),
  stat: vi.fn().mockResolvedValue({
    birthtimeMs: 1700000000000,
    mtimeMs: 1700100000000,
  }),
}));

import { deleteMetadata, readMetadata, writeMetadata } from '../metadata';
import { buildMergedMetadata } from './buildMetadata';

const mockedBuildMergedMetadata = buildMergedMetadata as Mock;
const mockedReadMetadata = readMetadata as Mock;
const mockedWriteMetadata = writeMetadata as Mock;
const mockedDeleteMetadata = deleteMetadata as Mock;

interface MockVectorStore {
  getPayload: Mock;
  upsert: Mock;
  delete: Mock;
  setPayload: Mock;
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
    getPayload: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    setPayload: vi.fn().mockResolvedValue(undefined),
  };

  const embeddingProvider: EmbeddingProvider = {
    dimensions: 3,
    embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  };

  const issuesManager: MockIssuesManager = {
    record: vi.fn(),
    clear: vi.fn(),
  };

  const valuesManager: MockValuesManager = {
    update: vi.fn(),
  };

  const config: ProcessorConfig = {
    metadataDir: '/tmp/meta',
    chunkSize: 1000,
    chunkOverlap: 200,
  };

  const logger = pino({ level: 'silent' });

  return {
    vectorStore,
    embeddingProvider,
    issuesManager,
    valuesManager,
    config,
    logger,
  };
}

function defaultMergedMetadata(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { domain: 'test', ...overrides },
    extracted: { text: 'hello world', frontmatter: null, json: null },
    renderedContent: null,
    matchedRules: ['rule1'],
    inferred: { domain: 'test' },
    enrichment: null,
    attributes: {},
  };
}

describe('DocumentProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processFile', () => {
    it('skips empty files', async () => {
      const { vectorStore, embeddingProvider, config, logger } = createMocks();
      mockedBuildMergedMetadata.mockResolvedValue({
        ...defaultMergedMetadata(),
        extracted: { text: '   ', frontmatter: null, json: null },
      });

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
      });
      await processor.processFile('/test.txt');

      expect(vectorStore.upsert).not.toHaveBeenCalled();
    });

    it('skips when content hash is unchanged', async () => {
      const { vectorStore, embeddingProvider, config, logger } = createMocks();
      mockedBuildMergedMetadata.mockResolvedValue(defaultMergedMetadata());

      // Simulate existing payload with matching hash
      const { contentHash } = await import('../hash');
      const hash = contentHash('hello world');
      vectorStore.getPayload.mockResolvedValue({
        content_hash: hash,
        total_chunks: 1,
      });

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
      });
      await processor.processFile('/test.txt');

      expect(vectorStore.upsert).not.toHaveBeenCalled();
    });

    it('processes successfully: clears issues, updates values', async () => {
      const {
        vectorStore,
        embeddingProvider,
        issuesManager,
        valuesManager,
        config,
        logger,
      } = createMocks();
      mockedBuildMergedMetadata.mockResolvedValue(defaultMergedMetadata());
      vectorStore.getPayload.mockResolvedValue(null);

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
        issuesManager: issuesManager as unknown as IssuesManager,
        valuesManager: valuesManager as unknown as ValuesManager,
      });
      await processor.processFile('/test.txt');

      expect(vectorStore.upsert).toHaveBeenCalledOnce();
      expect(issuesManager.clear).toHaveBeenCalledWith('/test.txt');
      expect(valuesManager.update).toHaveBeenCalledWith(
        'rule1',
        expect.objectContaining({ domain: 'test' }),
      );
    });

    it('does not record a v2 issue on generic error', async () => {
      const { vectorStore, embeddingProvider, issuesManager, config, logger } =
        createMocks();
      mockedBuildMergedMetadata.mockRejectedValue(new Error('read fail'));

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
        issuesManager: issuesManager as unknown as IssuesManager,
      });
      await processor.processFile('/test.txt');

      expect(issuesManager.record).not.toHaveBeenCalled();
    });

    it('cleans up orphan chunks when new count < old', async () => {
      const { vectorStore, embeddingProvider, config, logger } = createMocks();
      mockedBuildMergedMetadata.mockResolvedValue(defaultMergedMetadata());

      // Old payload had 3 chunks, new text produces 1 chunk
      vectorStore.getPayload.mockResolvedValue({
        content_hash: 'old-hash',
        total_chunks: 3,
      });

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
      });
      await processor.processFile('/test.txt');

      // Should delete orphan chunk IDs (indices 1 and 2)
      expect(vectorStore.delete).toHaveBeenCalledOnce();
      const deletedIds = vectorStore.delete.mock.calls[0][0] as string[];
      expect(deletedIds).toHaveLength(2);
    });
  });

  describe('processRulesUpdate', () => {
    it('returns null when file is not indexed', async () => {
      const { vectorStore, embeddingProvider, config, logger } = createMocks();
      vectorStore.getPayload.mockResolvedValue(null);

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
      });
      const result = await processor.processRulesUpdate('/test.txt');

      expect(result).toBeNull();
    });

    it('clears issues and updates values', async () => {
      const {
        vectorStore,
        embeddingProvider,
        issuesManager,
        valuesManager,
        config,
        logger,
      } = createMocks();
      vectorStore.getPayload.mockResolvedValue({ total_chunks: 2 });
      mockedBuildMergedMetadata.mockResolvedValue(defaultMergedMetadata());

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
        issuesManager: issuesManager as unknown as IssuesManager,
        valuesManager: valuesManager as unknown as ValuesManager,
      });
      const result = await processor.processRulesUpdate('/test.txt');

      expect(result).toEqual(expect.objectContaining({ domain: 'test' }));
      expect(issuesManager.clear).toHaveBeenCalledWith('/test.txt');
      expect(valuesManager.update).toHaveBeenCalled();
      expect(vectorStore.setPayload).toHaveBeenCalledOnce();
    });
  });

  describe('processMetadataUpdate', () => {
    it('merges metadata and updates Qdrant payloads', async () => {
      const { vectorStore, embeddingProvider, config, logger } = createMocks();
      mockedReadMetadata.mockResolvedValue({ existing: 'old' });
      vectorStore.getPayload.mockResolvedValue({ total_chunks: 2 });

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
      });
      const result = await processor.processMetadataUpdate('/test.txt', {
        newKey: 'val',
      });

      expect(mockedWriteMetadata).toHaveBeenCalledWith(
        '/test.txt',
        '/tmp/meta',
        { existing: 'old', newKey: 'val' },
      );
      expect(vectorStore.setPayload).toHaveBeenCalledOnce();
      expect(result).toEqual({ existing: 'old', newKey: 'val' });
    });

    it('returns null when file is not indexed', async () => {
      const { vectorStore, embeddingProvider, config, logger } = createMocks();
      mockedReadMetadata.mockResolvedValue(null);
      vectorStore.getPayload.mockResolvedValue(null);

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
      });
      const result = await processor.processMetadataUpdate('/test.txt', {
        key: 'val',
      });

      expect(result).toBeNull();
    });
  });

  describe('deleteFile', () => {
    it('removes chunks and metadata', async () => {
      const { vectorStore, embeddingProvider, config, logger } = createMocks();
      vectorStore.getPayload.mockResolvedValue({ total_chunks: 3 });

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
      });
      await processor.deleteFile('/test.txt');

      expect(vectorStore.delete).toHaveBeenCalledOnce();
      const deletedIds = vectorStore.delete.mock.calls[0][0] as string[];
      expect(deletedIds).toHaveLength(3);
      expect(mockedDeleteMetadata).toHaveBeenCalledWith(
        '/test.txt',
        '/tmp/meta',
      );
    });
  });
});
