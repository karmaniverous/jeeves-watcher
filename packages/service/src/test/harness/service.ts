/**
 * @module test/harness/service
 * Service integration harness: real Qdrant (throwaway `jeeves_watcher_it_*` collection, startup ensureCollection incl. payload indexes) + real processor (rule templates, global schemas, source client, counted mock embeddings) + the real Fastify API, optionally on 127.0.0.1.
 * Setup failures roll back: the collection is dropped and state removed before the error propagates.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PayloadIndexConfig } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';

import { createApiServer } from '../../api';
import { createProcessorConfig } from '../../app/initialization';
import type { JeevesWatcherConfig } from '../../config/types';
import { createEmbeddingProvider } from '../../embedding';
import { EnrichmentStore } from '../../enrichment';
import { IssuesManager } from '../../issues';
import { createLogger } from '../../logger';
import { DocumentProcessor } from '../../processor';
import { EventQueue } from '../../queue';
import { SourceNotifyQueue } from '../../queue/SourceNotifyQueue';
import { compileRules } from '../../rules';
import { SourceClient } from '../../sources';
import { buildTemplateEngine } from '../../templates';
import { ValuesManager } from '../../values';
import { VectorStoreClient } from '../../vectorStore';
import { createTestConfig } from '../helpers';
import { countingProvider, type EmbedCounter } from './countingProvider';
import {
  assertTestCollection,
  dropCollection,
  QDRANT_URL,
  uniqueCollectionName,
} from './qdrant';

/** Small vector size keeps harness collections cheap. */
export const HARNESS_DIMENSIONS = 16;

/** Options for {@link startServiceHarness}. */
export interface ServiceHarnessOptions {
  /** Suite label used in the collection name. */
  label: string;
  /** `api.apiKey` for the server (undefined = no auth). */
  apiKey?: string;
  /** `vectorStore.payloadIndexes`. */
  payloadIndexes?: PayloadIndexConfig[];
  /** Further config overrides, applied last (shallow, per top-level key). */
  config?: Partial<JeevesWatcherConfig>;
  /** Listen on an ephemeral 127.0.0.1 port and expose {@link ServiceHarness.baseUrl}. */
  listen?: boolean;
}

/** A started harness. Call {@link ServiceHarness.close} in `afterAll`. */
export interface ServiceHarness {
  /** The Fastify API (use `inject`, or `baseUrl` when listening). */
  app: FastifyInstance;
  /** Effective config. */
  config: JeevesWatcherConfig;
  /** Throwaway Qdrant collection name. */
  collectionName: string;
  /** Vector store client bound to the collection. */
  vectorStore: VectorStoreClient;
  /** Document processor wired to the collection. */
  processor: DocumentProcessor;
  /** Started source notify queue behind `POST /documents`. */
  sourceQueue: SourceNotifyQueue;
  /** Enrichment store (state dir). */
  enrichmentStore: EnrichmentStore;
  /** Issues store (state dir). */
  issuesManager: IssuesManager;
  /** Live embedding counters (processor, reindex and search share one provider). */
  embeddings: EmbedCounter;
  /** Private state directory. */
  stateDir: string;
  /** Base URL when started with `listen: true`. */
  baseUrl?: string;
  /** Close the server and stores, drop the collection, remove state. */
  close: () => Promise<void>;
}

/**
 * Build the harness config: test defaults, a unique collection on the
 * harness Qdrant, a private state dir, then the caller's overrides.
 */
function buildConfig(
  options: ServiceHarnessOptions,
  collectionName: string,
  stateDir: string,
): JeevesWatcherConfig {
  const base = createTestConfig();
  return {
    ...base,
    stateDir,
    embedding: { ...base.embedding, dimensions: HARNESS_DIMENSIONS },
    vectorStore: {
      url: QDRANT_URL,
      collectionName,
      apiKey: process.env['QDRANT_API_KEY'],
      payloadIndexes: options.payloadIndexes,
    },
    api: { ...base.api, apiKey: options.apiKey },
    ...options.config,
  };
}

/** Teardown steps registered as setup progresses (run in reverse). */
type Cleanup = Array<() => Promise<void> | void>;

/** Run every cleanup step in reverse order; the first error is rethrown. */
async function runCleanup(cleanup: Cleanup): Promise<void> {
  let first: Error | undefined;
  for (const step of [...cleanup].reverse()) {
    try {
      await step();
    } catch (error) {
      first ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (first) throw first;
}

/**
 * Start a service harness against the real Qdrant. Callers must guard with
 * `describe.skipIf(!qdrantAvailable())`. If any setup step fails, everything
 * created so far (collection included) is torn down before the error
 * propagates, so a failing `beforeAll` never leaks a collection.
 *
 * @param options - Harness options.
 * @returns The started harness.
 * @throws When the effective collection name is not a harness collection.
 */
export async function startServiceHarness(
  options: ServiceHarnessOptions,
): Promise<ServiceHarness> {
  const cleanup: Cleanup = [];
  try {
    return await setUp(options, cleanup);
  } catch (error) {
    await runCleanup(cleanup).catch(() => undefined);
    throw error;
  }
}

/** Setup body of {@link startServiceHarness}; registers teardown as it goes. */
async function setUp(
  options: ServiceHarnessOptions,
  cleanup: Cleanup,
): Promise<ServiceHarness> {
  const stateDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-'));
  cleanup.push(() => rm(stateDir, { recursive: true, force: true }));
  const config = buildConfig(
    options,
    uniqueCollectionName(options.label),
    stateDir,
  );
  const { collectionName } = config.vectorStore;
  assertTestCollection(collectionName);
  const logger = createLogger({ level: 'silent' });

  const { provider: embeddingProvider, counter } = countingProvider(
    createEmbeddingProvider(config.embedding),
  );
  const vectorStore = new VectorStoreClient(
    config.vectorStore,
    embeddingProvider.dimensions,
    logger,
  );
  cleanup.push(() => dropCollection(collectionName));
  await vectorStore.ensureCollection();

  const enrichmentStore = new EnrichmentStore(stateDir, logger);
  cleanup.push(() => {
    enrichmentStore.close();
  });
  const issuesManager = new IssuesManager(stateDir, logger);
  const valuesManager = new ValuesManager(stateDir, logger);
  const inferenceRules = config.inferenceRules ?? [];
  const processor = new DocumentProcessor({
    config: createProcessorConfig(config, stateDir, undefined),
    embeddingProvider,
    vectorStore,
    compiledRules: compileRules(inferenceRules),
    logger,
    templateEngine: await buildTemplateEngine(inferenceRules),
    enrichmentStore,
    issuesManager,
    valuesManager,
    sourceRetriever: new SourceClient(config.sources),
  });

  const sourceQueue = new SourceNotifyQueue(
    processor,
    { concurrency: 2 },
    logger,
    issuesManager,
  );
  sourceQueue.start();
  cleanup.push(() => sourceQueue.stop());

  const app = createApiServer({
    descriptor: { name: 'watcher' } as never,
    processor,
    vectorStore,
    embeddingProvider,
    queue: new EventQueue({ debounceMs: 0, concurrency: 1 }),
    sourceQueue,
    config,
    logger,
    issuesManager,
    valuesManager,
    enrichmentStore,
    configPath: join(stateDir, 'jeeves-watcher.config.json'),
  });
  cleanup.push(() => app.close());

  let baseUrl: string | undefined;
  if (options.listen) {
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  } else {
    await app.ready();
  }

  return {
    app,
    config,
    collectionName,
    vectorStore,
    processor,
    sourceQueue,
    enrichmentStore,
    issuesManager,
    embeddings: counter,
    stateDir,
    baseUrl,
    close: () => runCleanup(cleanup),
  };
}
