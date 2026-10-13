/**
 * @module processor/processor.updates.test
 * Unit tests for DocumentProcessor.processRulesUpdate, processMetadataUpdate and deleteFile with mocked stores.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { IssuesManager } from '../issues';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor } from './index';
import {
  createMockEnrichmentStore,
  createMocks,
  defaultMergedMetadata,
} from './processorTestMocks';

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
      const enrichmentStore = createMockEnrichmentStore({
        existing: 'old',
        newKey: 'val',
      });
      vectorStore.getPayload.mockResolvedValue({ total_chunks: 2 });

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
        enrichmentStore: enrichmentStore,
      });
      const result = await processor.processMetadataUpdate('/test.txt', {
        newKey: 'val',
      });

      expect(enrichmentStore.set).toHaveBeenCalledWith('/test.txt', {
        newKey: 'val',
      });
      expect(enrichmentStore.get).toHaveBeenCalledWith('/test.txt');
      expect(vectorStore.setPayload).toHaveBeenCalledOnce();
      expect(result).toEqual({ existing: 'old', newKey: 'val' });
    });

    it('returns null when file is not indexed', async () => {
      const { vectorStore, embeddingProvider, config, logger } = createMocks();
      const enrichmentStore = createMockEnrichmentStore(null);
      vectorStore.getPayload.mockResolvedValue(null);

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
        enrichmentStore: enrichmentStore,
      });
      const result = await processor.processMetadataUpdate('/test.txt', {
        key: 'val',
      });

      expect(result).toBeNull();
    });
  });

  describe('deleteFile', () => {
    it('removes chunks and enrichment', async () => {
      const { vectorStore, embeddingProvider, config, logger } = createMocks();
      const enrichmentStore = createMockEnrichmentStore(null);
      vectorStore.getPayload.mockResolvedValue({ total_chunks: 3 });

      const processor = new DocumentProcessor({
        config,
        embeddingProvider,
        vectorStore: vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger,
        enrichmentStore: enrichmentStore,
      });
      await processor.deleteFile('/test.txt');

      expect(vectorStore.delete).toHaveBeenCalledOnce();
      const deletedIds = vectorStore.delete.mock.calls[0][0] as string[];
      expect(deletedIds).toHaveLength(3);
      expect(enrichmentStore.delete).toHaveBeenCalledWith('/test.txt');
    });
  });
});
