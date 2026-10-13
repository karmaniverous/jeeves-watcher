/**
 * @module test/legacyIntegration
 * Shared fixture for the pre-0.20.0 file integration suites (`integration*.test.ts`): registers vitest hooks that open a guarded harness collection on the run's Qdrant, a DocumentProcessor with mock embeddings and an EnrichmentStore, and reset the temp watch dir and collection after every test.
 */

import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { createProcessorConfig } from '../app/initialization';
import { ROOT_DEFAULTS } from '../config/defaults';
import type { JeevesWatcherConfig } from '../config/types';
import { createEmbeddingProvider, type EmbeddingProvider } from '../embedding';
import { EnrichmentStore } from '../enrichment';
import { createLogger } from '../logger';
import { DocumentProcessor } from '../processor';
import { compileRules } from '../rules';
import { VectorStoreClient } from '../vectorStore';
import { assertTestVectorStore, dropCollection } from './harness/qdrant';
import {
  cleanupTestDirs,
  cleanupWatchedDir,
  createTestConfig,
  setupTestDirs,
} from './helpers';

/** Components of a legacy integration suite (stores set in `beforeAll`). */
export interface LegacyIntegration {
  /** Effective config (unique harness collection on the run's Qdrant). */
  config: JeevesWatcherConfig;
  /** Mock embedding provider. */
  embeddingProvider: EmbeddingProvider;
  /** Silent logger. */
  logger: ReturnType<typeof createLogger>;
  /** Vector store bound to the collection. */
  vectorStore: VectorStoreClient;
  /** Processor without rules. */
  processor: DocumentProcessor;
  /** Enrichment store in the temp state dir. */
  enrichmentStore: EnrichmentStore;
}

/**
 * Register the suite hooks and return the components; the stores are
 * populated by the registered `beforeAll`. Call inside a `describe`.
 *
 * @returns The (lazily populated) components.
 */
export function useLegacyIntegration(): LegacyIntegration {
  // Unique `jeeves_watcher_it_legacy_*` collection on the run's Qdrant.
  const config = createTestConfig({ label: 'legacy' });
  const fixture = {
    config,
    embeddingProvider: createEmbeddingProvider(config.embedding),
    logger: createLogger({ level: 'silent' }),
  } as LegacyIntegration;

  beforeAll(async () => {
    // Pay Fastify's one-time cold start in this hook rather than inside the
    // first timed API case (#243): the first Fastify() lazily requires
    // ajv/fast-json-stringify and the first inject() lazily requires
    // light-my-request.
    const warm = Fastify();
    warm.get('/', () => 'ok');
    await warm.inject({ method: 'GET', url: '/' });
    await warm.close();

    assertTestVectorStore(config.vectorStore);
    fixture.vectorStore = new VectorStoreClient(
      config.vectorStore,
      fixture.embeddingProvider.dimensions,
    );

    // Use raw Qdrant HTTP to ensure clean collection
    await dropCollection(config.vectorStore.collectionName);
    await fixture.vectorStore.ensureCollection();

    const stateDir = config.stateDir ?? ROOT_DEFAULTS.stateDir;
    fixture.enrichmentStore = new EnrichmentStore(stateDir);

    fixture.processor = new DocumentProcessor({
      config: createProcessorConfig(config, stateDir, undefined),
      embeddingProvider: fixture.embeddingProvider,
      vectorStore: fixture.vectorStore,
      compiledRules: compileRules(config.inferenceRules ?? []),
      logger: fixture.logger,
      enrichmentStore: fixture.enrichmentStore,
    });
  });

  afterAll(async () => {
    // Drop first: runs even when beforeAll failed before the store opened.
    await dropCollection(config.vectorStore.collectionName);
    // Undefined when beforeAll failed before the store opened.
    (fixture.enrichmentStore as EnrichmentStore | undefined)?.close();
    await cleanupTestDirs();
  });

  beforeEach(async () => {
    await setupTestDirs();
  });

  afterEach(async () => {
    // Clear all points from collection
    await dropCollection(config.vectorStore.collectionName);
    await fixture.vectorStore.ensureCollection();
    await cleanupWatchedDir();
  });

  return fixture;
}
