/**
 * @module processor/processorTestMocks
 * Shared vitest mocks for the DocumentProcessor unit suites (processor*.test.ts): mock vector store, embeddings, issues, values and enrichment stores, plus a default buildMergedMetadata result. No I/O.
 */

import pino from 'pino';
import { type Mock, vi } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
import type { ProcessorConfig } from './index';

/** Mock VectorStore (vi.fn members). */
interface MockVectorStore {
  getPayload: Mock;
  upsert: Mock;
  delete: Mock;
  setPayload: Mock;
}

/** Mock IssuesManager (vi.fn members). */
interface MockIssuesManager {
  record: Mock;
  clear: Mock;
}

/** Mock ValuesManager (vi.fn members). */
interface MockValuesManager {
  update: Mock;
}

/** Mock EnrichmentStore (vi.fn members). */
interface MockEnrichmentStore {
  get: Mock;
  set: Mock;
  delete: Mock;
  move: Mock;
  list: Mock;
  close: Mock;
}

/**
 * A mock enrichment store whose get() returns data.
 *
 * @param data - Value returned by get().
 * @returns The mock store.
 */
export function createMockEnrichmentStore(
  data: Record<string, unknown> | null = null,
): MockEnrichmentStore {
  return {
    get: vi.fn().mockReturnValue(data),
    set: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  };
}

/**
 * Fresh mocks for a DocumentProcessor: vector store, embeddings, issues and values stores, config and a silent logger.
 *
 * @returns The mocks.
 */
export function createMocks() {
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

/**
 * A buildMergedMetadata result for text hello world matched by rule1.
 *
 * @param overrides - Extra metadata keys.
 * @returns The merged-metadata result.
 */
export function defaultMergedMetadata(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { domain: 'test', ...overrides },
    extracted: { text: 'hello world', frontmatter: null, json: null },
    renderedContent: null,
    matchedRules: ['rule1'],
    inferred: { domain: 'test' },
    enrichment: null,
    attributes: {},
    // Matches the stat mocks of the processor tests.
    dates: { createdAt: 1700000000, modifiedAt: 1700100000 },
  };
}
