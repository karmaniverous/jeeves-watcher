/**
 * @module processor/processor.test
 * Unit tests for DocumentProcessor.processFile with mocked stores: empty files, unchanged content hashes, values and issues bookkeeping, extraction errors and orphan-chunk cleanup.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { IssuesManager } from '../issues';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor } from './index';
import { createMocks, defaultMergedMetadata } from './processorTestMocks';

// Mock buildMergedMetadata so we don't touch the filesystem
vi.mock('./buildMetadata', () => ({
  buildMergedMetadata: vi.fn(),
}));

// Mock node:fs/promises stat() and readFile() to return predictable values
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  stat: vi.fn().mockResolvedValue({
    birthtimeMs: 1700000000000,
    mtimeMs: 1700100000000,
  }),
  readFile: vi.fn().mockResolvedValue(Buffer.from('mock file content')),
}));

import { buildMergedMetadata } from './buildMetadata';

const mockedBuildMergedMetadata = buildMergedMetadata as Mock;

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

    it('updates values even when content hash is unchanged', async () => {
      const { vectorStore, embeddingProvider, valuesManager, config, logger } =
        createMocks();
      mockedBuildMergedMetadata.mockResolvedValue(defaultMergedMetadata());

      // Simulate existing payload with matching hash — embedding skipped
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
        valuesManager: valuesManager as unknown as ValuesManager,
      });
      await processor.processFile('/test.txt');

      // Embedding should be skipped
      expect(vectorStore.upsert).not.toHaveBeenCalled();
      // But values should still be updated
      expect(valuesManager.update).toHaveBeenCalledWith(
        'rule1',
        expect.objectContaining({ domain: 'test' }),
      );
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

    it('records an extraction_error issue on generic error', async () => {
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

      expect(issuesManager.record.mock.calls[0]?.[1]).toBe('extraction_error');
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
});
