/**
 * @module test/integration.api.test
 * File integration (requires Qdrant), pre-0.20.0 suite: API endpoints over indexed files (/rebuild-metadata, /metadata, /search filtered to one document). Shared setup: {@link useLegacyIntegration}.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { createApiServer } from '../api';
import { ROOT_DEFAULTS } from '../config/defaults';
import type { EnrichmentStore } from '../enrichment';
import { IssuesManager } from '../issues';
import { pointId } from '../pointId';
import type { DocumentProcessor } from '../processor';
import { EventQueue } from '../queue';
import { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { qdrantAvailable } from './harness/qdrant';
import { getWatchDir } from './helpers';
import { useLegacyIntegration } from './legacyIntegration';

describe.skipIf(!qdrantAvailable())(
  'Integration tests (requires Qdrant)',
  () => {
    const fixture = useLegacyIntegration();
    const { config, embeddingProvider, logger } = fixture;
    let vectorStore: VectorStoreClient;
    let processor: DocumentProcessor;
    let enrichmentStore: EnrichmentStore;

    beforeAll(() => {
      ({ vectorStore, processor, enrichmentStore } = fixture);
    });

    describe('API endpoints', () => {
      it('POST /rebuild-metadata should write meta files from Qdrant payloads', async () => {
        const filePath = join(getWatchDir(), 'rebuild.txt');
        await writeFile(filePath, 'Rebuild metadata content', 'utf8');
        await processor.processFile(filePath);
        await processor.processMetadataUpdate(filePath, {
          title: 'Rebuilt Title',
        });
        // Lose the local enrichment: only Qdrant can restore it.
        enrichmentStore.delete(filePath);
        expect(enrichmentStore.get(filePath)).toBeNull();

        const stateDir = config.stateDir ?? ROOT_DEFAULTS.stateDir;
        const server = createApiServer({
          descriptor: { name: 'watcher' } as never,
          processor,
          vectorStore,
          embeddingProvider,
          queue: new EventQueue({ debounceMs: 0, concurrency: 1 }),
          config,
          logger,
          issuesManager: new IssuesManager(stateDir, logger),
          valuesManager: new ValuesManager(stateDir, logger),
          enrichmentStore,
          configPath: '',
        });
        onTestFinished(() => server.close());

        const res = await server.inject({
          method: 'POST',
          url: '/rebuild-metadata',
        });
        expect(res.statusCode).toBe(200);

        const meta = enrichmentStore.get(filePath);
        expect(meta).not.toBeNull();
        expect(meta!['title']).toBe('Rebuilt Title');
      });
    });

    describe('Metadata enrichment via API', () => {
      it('should enrich metadata via POST /metadata', async () => {
        const filePath = join(getWatchDir(), 'enrich-api.txt');
        await writeFile(filePath, 'Content for API enrichment test.', 'utf8');
        await processor.processFile(filePath);

        const stateDir = config.stateDir ?? ROOT_DEFAULTS.stateDir;
        const server = createApiServer({
          descriptor: { name: 'watcher' } as never,
          processor,
          vectorStore,
          embeddingProvider,
          queue: new EventQueue({ debounceMs: 0, concurrency: 1 }),
          config,
          logger,
          issuesManager: new IssuesManager(stateDir, logger),
          valuesManager: new ValuesManager(stateDir, logger),
          enrichmentStore,
          configPath: '',
        });
        onTestFinished(() => server.close());

        // Enrich via API
        const res = await server.inject({
          method: 'POST',
          url: '/metadata',
          payload: {
            path: filePath,
            metadata: { category: 'documentation', priority: 'high' },
          },
        });

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { ok: boolean };
        expect(body.ok).toBe(true);

        // Verify metadata in Qdrant
        const id = pointId(filePath, 0);
        const payload = await vectorStore.getPayload(id);
        expect(payload).not.toBeNull();
        expect(payload!['category']).toBe('documentation');
        expect(payload!['priority']).toBe('high');
      });
    });

    describe('Search endpoint', () => {
      it('should return relevant results from POST /search', async () => {
        const filePath1 = join(getWatchDir(), 'search-doc1.txt');
        const filePath2 = join(getWatchDir(), 'search-doc2.txt');

        await writeFile(
          filePath1,
          'This document is about machine learning algorithms.',
          'utf8',
        );
        await writeFile(
          filePath2,
          'This document discusses natural language processing.',
          'utf8',
        );

        await processor.processFile(filePath1);
        await processor.processFile(filePath2);

        const stateDir = config.stateDir ?? ROOT_DEFAULTS.stateDir;
        const server = createApiServer({
          descriptor: { name: 'watcher' } as never,
          processor,
          vectorStore,
          embeddingProvider,
          queue: new EventQueue({ debounceMs: 0, concurrency: 1 }),
          config,
          logger,
          issuesManager: new IssuesManager(stateDir, logger),
          valuesManager: new ValuesManager(stateDir, logger),
          configPath: '',
        });
        onTestFinished(() => server.close());

        // Mock embeddings carry no meaning: filter to one document and
        // expect exactly its chunk back.
        const stored = await vectorStore.getPayload(pointId(filePath1, 0));
        const res = await server.inject({
          method: 'POST',
          url: '/search',
          payload: {
            query: 'machine learning',
            limit: 5,
            filter: {
              must: [
                { key: 'file_path', match: { value: stored!['file_path'] } },
              ],
            },
          },
        });

        expect(res.statusCode).toBe(200);
        const results = JSON.parse(res.body) as Array<{
          id: string;
          payload: Record<string, unknown>;
        }>;
        expect(results).toHaveLength(1);
        expect(results[0]?.id).toBe(pointId(filePath1, 0));
        expect(results[0]?.payload['chunk_text']).toBe(
          'This document is about machine learning algorithms.',
        );
      });
    });
  },
);
