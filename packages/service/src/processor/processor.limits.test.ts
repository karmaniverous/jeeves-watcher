/**
 * @module processor/processor.limits.test
 * DocumentProcessor reads the processing ceilings per document (D44: reload applies): for each of maxFileBytes, maxChunksPerFile and maxTextBytes, the same file is too_large under a tight limit and indexed once the getter returns a looser one.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor } from './index';
import {
  DEFAULT_PROCESSING_LIMITS,
  type ProcessingLimits,
} from './processingLimits';
import { createMocks, defaultMergedMetadata } from './processorTestMocks';

vi.mock('./buildMetadata', () => ({
  buildMergedMetadata: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  stat: vi.fn().mockResolvedValue({
    size: 100,
    birthtimeMs: 1700000000000,
    mtimeMs: 1700100000000,
  }),
  readFile: vi.fn().mockResolvedValue(Buffer.from('mock file content')),
}));

import { buildMergedMetadata } from './buildMetadata';

const mockedBuildMergedMetadata = buildMergedMetadata as Mock;

describe('DocumentProcessor processing limits (read per document)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 'hello world': 11 bytes of text, 1 chunk.
    mockedBuildMergedMetadata.mockResolvedValue(defaultMergedMetadata());
  });

  it.each<[string, Partial<ProcessingLimits>]>([
    ['maxFileBytes', { maxFileBytes: 99 }],
    ['maxChunksPerFile', { maxChunksPerFile: 0 }],
    ['maxTextBytes', { maxTextBytes: 10 }],
  ])(
    '%s: too_large under a tight limit, indexed after the getter loosens it',
    async (key, tight) => {
      const mocks = createMocks();
      let limits: ProcessingLimits = { ...DEFAULT_PROCESSING_LIMITS, ...tight };
      const processor = new DocumentProcessor({
        config: mocks.config,
        embeddingProvider: mocks.embeddingProvider,
        vectorStore: mocks.vectorStore as unknown as VectorStoreClient,
        compiledRules: [],
        logger: mocks.logger,
        issuesManager: mocks.issuesManager as never,
        getProcessingLimits: () => limits,
      });

      await processor.processFile('/docs/a.md');
      expect(mocks.vectorStore.upsert).not.toHaveBeenCalled();
      expect(mocks.issuesManager.record).toHaveBeenCalledWith(
        '/docs/a.md',
        'too_large',
        expect.stringContaining(key),
        expect.objectContaining({ operation: 'Failed to process file' }),
      );

      limits = DEFAULT_PROCESSING_LIMITS;
      await processor.processFile('/docs/a.md');
      expect(mocks.vectorStore.upsert).toHaveBeenCalled();
    },
  );
});
