/**
 * @module processor/moveFile.test
 * Tests for DocumentProcessor.moveFile stub.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

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

describe('DocumentProcessor.moveFile', () => {
  it('throws not-implemented error (stub)', async () => {
    const vectorStore = {
      getPayload: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      setPayload: vi.fn(),
    };

    const embeddingProvider: EmbeddingProvider = {
      dimensions: 3,
      embed: vi.fn(),
    };

    const config: ProcessorConfig = {
      metadataDir: '/tmp/meta',
    };

    const processor = new DocumentProcessor({
      config,
      embeddingProvider,
      vectorStore: vectorStore as unknown as VectorStoreClient,
      compiledRules: [],
      logger: pino({ level: 'silent' }),
    });

    await expect(processor.moveFile('/old.txt', '/new.txt')).rejects.toThrow(
      'moveFile not yet implemented',
    );
  });
});
