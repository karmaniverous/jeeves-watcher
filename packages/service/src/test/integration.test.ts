import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { createApiServer } from '../api';
import { createEmbeddingProvider } from '../embedding';
import { EnrichmentStore } from '../enrichment';
import { IssuesManager } from '../issues';
import { createLogger } from '../logger';
import { pointId } from '../pointId';
import { DocumentProcessor } from '../processor';
import { EventQueue } from '../queue';
import { compileRules } from '../rules';
import { ValuesManager } from '../values';
import { VectorStoreClient } from '../vectorStore';
import {
  cleanupTestDirs,
  cleanupWatchedDir,
  createTestConfig,
  getWatchDir,
  setupTestDirs,
} from './helpers';

const skipIntegration = process.env['QDRANT_AVAILABLE'] !== 'true';

describe.skipIf(skipIntegration)('Integration tests (requires Qdrant)', () => {
  const config = createTestConfig();
  const embeddingProvider = createEmbeddingProvider(config.embedding);
  const logger = createLogger({ level: 'silent' });

  let vectorStore: VectorStoreClient;
  let processor: DocumentProcessor;
  let enrichmentStore: EnrichmentStore;

  beforeAll(async () => {
    vectorStore = new VectorStoreClient(
      config.vectorStore,
      embeddingProvider.dimensions,
    );

    // Use raw Qdrant HTTP to ensure clean collection
    const url = config.vectorStore.url;
    const collectionName = config.vectorStore.collectionName;
    try {
      await fetch(`${url}/collections/${collectionName}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
    await vectorStore.ensureCollection();

    const compiledRules = compileRules(config.inferenceRules ?? []);

    const stateDir = config.stateDir ?? '.jeeves-metadata';
    enrichmentStore = new EnrichmentStore(stateDir);

    const processorConfig = {
      chunkSize: config.embedding.chunkSize,
      chunkOverlap: config.embedding.chunkOverlap,
      maps: config.maps,
    };

    processor = new DocumentProcessor({
      config: processorConfig,
      embeddingProvider,
      vectorStore,
      compiledRules,
      logger,
      enrichmentStore,
    });
  });

  afterAll(async () => {
    enrichmentStore.close();
    const url = config.vectorStore.url;
    const collectionName = config.vectorStore.collectionName;
    try {
      await fetch(`${url}/collections/${collectionName}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
    await cleanupTestDirs();
  });

  beforeEach(async () => {
    await setupTestDirs();
  });

  afterEach(async () => {
    // Clear all points from collection
    const url = config.vectorStore.url;
    const collectionName = config.vectorStore.collectionName;
    try {
      await fetch(`${url}/collections/${collectionName}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
    await vectorStore.ensureCollection();
    await cleanupWatchedDir();
  });

  describe('File add', () => {
    it('should index a new file with correct payload fields', async () => {
      const filePath = join(getWatchDir(), 'test.txt');
      await writeFile(
        filePath,
        'Hello world, this is a test document.',
        'utf8',
      );

      await processor.processFile(filePath);

      const id = pointId(filePath, 0);
      const payload = await vectorStore.getPayload(id);

      expect(payload).not.toBeNull();
      expect(payload!['file_path']).toBe(filePath.replace(/\\/g, '/'));
      expect(payload!['chunk_index']).toBe(0);
      expect(payload!['content_hash']).toBeTypeOf('string');
      expect(payload!['chunk_text']).toContain('Hello world');
    });
  });

  describe('File update', () => {
    it('should re-embed when content changes', async () => {
      const filePath = join(getWatchDir(), 'update.txt');
      await writeFile(filePath, 'Original content here.', 'utf8');
      await processor.processFile(filePath);

      const id = pointId(filePath, 0);
      const payload1 = await vectorStore.getPayload(id);
      const hash1 = payload1!['content_hash'];

      await writeFile(filePath, 'Updated content that is different.', 'utf8');
      await processor.processFile(filePath);

      const payload2 = await vectorStore.getPayload(id);
      expect(payload2!['content_hash']).not.toBe(hash1);
      expect(payload2!['chunk_text']).toContain('Updated content');
    });

    it('should skip re-embedding when content is unchanged', async () => {
      const filePath = join(getWatchDir(), 'same.txt');
      await writeFile(filePath, 'Same content.', 'utf8');
      await processor.processFile(filePath);

      const id = pointId(filePath, 0);
      const payload1 = await vectorStore.getPayload(id);

      // Process again — should skip (content hash matches)
      await processor.processFile(filePath);

      const payload2 = await vectorStore.getPayload(id);
      expect(payload2!['content_hash']).toBe(payload1!['content_hash']);
    });
  });

  describe('File delete', () => {
    it('should remove chunks from Qdrant', async () => {
      const filePath = join(getWatchDir(), 'delete-me.txt');
      await writeFile(filePath, 'Content to be deleted.', 'utf8');
      await processor.processFile(filePath);

      const id = pointId(filePath, 0);
      expect(await vectorStore.getPayload(id)).not.toBeNull();

      await processor.deleteFile(filePath);
      expect(await vectorStore.getPayload(id)).toBeNull();
    });
  });

  describe('Metadata update', () => {
    it('should update Qdrant payloads without re-embedding', async () => {
      const filePath = join(getWatchDir(), 'meta.txt');
      await writeFile(filePath, 'Content for metadata test.', 'utf8');
      await processor.processFile(filePath);

      const id = pointId(filePath, 0);
      const payloadBefore = await vectorStore.getPayload(id);
      const hashBefore = payloadBefore!['content_hash'];

      await processor.processMetadataUpdate(filePath, {
        title: 'Test Document',
        labels: ['test'],
      });

      const payloadAfter = await vectorStore.getPayload(id);
      // content_hash unchanged (no re-embed)
      expect(payloadAfter!['content_hash']).toBe(hashBefore);
      // metadata fields present
      expect(payloadAfter!['title']).toBe('Test Document');
      expect(payloadAfter!['labels']).toEqual(['test']);
    });
  });

  describe('API endpoints', () => {
    it('POST /rebuild-metadata should write meta files from Qdrant payloads', async () => {
      const filePath = join(getWatchDir(), 'rebuild.txt');
      await writeFile(filePath, 'Rebuild metadata content', 'utf8');
      await processor.processFile(filePath);
      await processor.processMetadataUpdate(filePath, {
        title: 'Rebuilt Title',
      });

      const stateDir = config.stateDir ?? '.jeeves-metadata';
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

      const res = await server.inject({
        method: 'POST',
        url: '/rebuild-metadata',
      });
      expect(res.statusCode).toBe(200);

      const meta = enrichmentStore.get(filePath);
      expect(meta).not.toBeNull();
      expect(meta!['title']).toBe('Rebuilt Title');
    });

    it('POST /reindex with scope:rules should start reindex asynchronously', async () => {
      const stateDir = config.stateDir ?? '.jeeves-metadata';
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

      const res = await server.inject({
        method: 'POST',
        url: '/reindex',
        payload: { scope: 'rules' },
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body) as { status: string; scope: string };
      expect(body.status).toBe('started');
      expect(body.scope).toBe('rules');
    });
  });

  describe('Rules engine', () => {
    it('should apply inferred metadata from rules', async () => {
      const watchDir = getWatchDir();
      const filePath = join(watchDir, 'meetings', 'notes.md');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(watchDir, 'meetings'), { recursive: true });
      await writeFile(
        filePath,
        '# Meeting Notes\nDiscussed project plans.',
        'utf8',
      );

      // Create processor with rules
      const rulesConfig = {
        ...config,
        inferenceRules: [
          {
            name: 'meetings-rule',
            description: 'Extract domain for meetings files',
            match: {
              properties: {
                file: {
                  properties: {
                    path: { type: 'string' as const, glob: '**/meetings/**' },
                  },
                },
              },
            },
            schema: [
              {
                properties: {
                  domain: { type: 'string', set: 'meetings' },
                },
              },
            ],
          },
        ],
      };

      const compiledRules = compileRules(rulesConfig.inferenceRules);
      const rulesProcessorConfig = {
        chunkSize: rulesConfig.embedding.chunkSize,
        chunkOverlap: rulesConfig.embedding.chunkOverlap,
        maps: rulesConfig.maps,
      };
      const rulesProcessor = new DocumentProcessor({
        config: rulesProcessorConfig,
        embeddingProvider,
        vectorStore,
        compiledRules,
        logger,
      });

      await rulesProcessor.processFile(filePath);

      const id = pointId(filePath, 0);
      const payload = await vectorStore.getPayload(id);
      expect(payload).not.toBeNull();
      expect(payload!['domain']).toBe('meetings');
    });
  });

  describe('Full document lifecycle', () => {
    it('should handle complete add/update/delete cycle', async () => {
      const filePath = join(getWatchDir(), 'lifecycle.txt');

      // Step 1: Add file
      await writeFile(filePath, 'Initial content for lifecycle test.', 'utf8');
      await processor.processFile(filePath);

      const id = pointId(filePath, 0);
      let payload = await vectorStore.getPayload(id);
      expect(payload).not.toBeNull();
      expect(payload!['chunk_text']).toContain('Initial content');
      const initialHash = payload!['content_hash'];

      // Step 2: Update file
      await writeFile(
        filePath,
        'Updated content that is completely different.',
        'utf8',
      );
      await processor.processFile(filePath);

      payload = await vectorStore.getPayload(id);
      expect(payload).not.toBeNull();
      expect(payload!['chunk_text']).toContain('Updated content');
      expect(payload!['content_hash']).not.toBe(initialHash);

      // Step 3: Delete file
      await processor.deleteFile(filePath);

      payload = await vectorStore.getPayload(id);
      expect(payload).toBeNull();
    });
  });

  describe('Metadata enrichment via API', () => {
    it('should enrich metadata via POST /metadata', async () => {
      const filePath = join(getWatchDir(), 'enrich-api.txt');
      await writeFile(filePath, 'Content for API enrichment test.', 'utf8');
      await processor.processFile(filePath);

      const stateDir = config.stateDir ?? '.jeeves-metadata';
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

  describe('File move', () => {
    it('should move points to new path without re-embedding', async () => {
      const filePath = join(getWatchDir(), 'move-source.txt');
      const newPath = join(getWatchDir(), 'move-dest.txt');
      await writeFile(filePath, 'Content for move test document.', 'utf8');

      await processor.processFile(filePath);

      const oldId = pointId(filePath, 0);
      const oldPayload = await vectorStore.getPayload(oldId);
      expect(oldPayload).not.toBeNull();
      const oldHash = oldPayload!['content_hash'];

      // Read old point with vectors to compare after move
      const oldPoints = await vectorStore.getPointsWithVectors([oldId]);
      expect(oldPoints).toHaveLength(1);
      const oldVector = oldPoints[0].vector;

      // Write file at new path (same content) for buildMetadataWithRules
      await writeFile(newPath, 'Content for move test document.', 'utf8');

      await processor.moveFile(filePath, newPath);

      // Old point should be gone
      const oldAfterMove = await vectorStore.getPayload(oldId);
      expect(oldAfterMove).toBeNull();

      // New point should exist with same vector
      const newId = pointId(newPath, 0);
      const newPayload = await vectorStore.getPayload(newId);
      expect(newPayload).not.toBeNull();
      expect(newPayload!['file_path']).toBe(newPath.replace(/\\/g, '/'));
      expect(newPayload!['content_hash']).toBe(oldHash);

      // Vector should be identical (no re-embedding)
      const newPoints = await vectorStore.getPointsWithVectors([newId]);
      expect(newPoints).toHaveLength(1);
      expect(newPoints[0].vector).toEqual(oldVector);
    });

    it('should migrate enrichment on move', async () => {
      const filePath = join(getWatchDir(), 'move-enriched.txt');
      const newPath = join(getWatchDir(), 'move-enriched-dest.txt');
      await writeFile(filePath, 'Enriched content for move.', 'utf8');

      await processor.processFile(filePath);

      // Add enrichment
      enrichmentStore.set(filePath, {
        category: 'important',
        tags: ['review'],
      });

      // Write file at new path for buildMetadataWithRules
      await writeFile(newPath, 'Enriched content for move.', 'utf8');

      await processor.moveFile(filePath, newPath);

      // Enrichment should be at new path
      const movedEnrichment = enrichmentStore.get(newPath);
      expect(movedEnrichment).not.toBeNull();
      expect(movedEnrichment!['category']).toBe('important');
      expect(movedEnrichment!['tags']).toEqual(['review']);

      // Old path enrichment should be gone
      expect(enrichmentStore.get(filePath)).toBeNull();
    });

    it('should preserve enrichments through full reindex', async () => {
      const filePath = join(getWatchDir(), 'persist.txt');
      await writeFile(filePath, 'Content that gets enriched.', 'utf8');

      await processor.processFile(filePath);

      const id = pointId(filePath, 0);
      const payloadBefore = await vectorStore.getPayload(id);
      expect(payloadBefore).not.toBeNull();

      // Enrich the file via the store
      enrichmentStore.set(filePath, { resonant: true });

      // Simulate full reindex: modify file content to force re-embed
      // (a real full reindex calls processFile on every file; the content
      // hash check skips unchanged files, so we change the content)
      await writeFile(
        filePath,
        'Content that gets enriched — updated for reindex.',
        'utf8',
      );
      await processor.processFile(filePath);

      const payload = await vectorStore.getPayload(id);
      expect(payload).not.toBeNull();
      // Enrichment should have been merged back in from SQLite
      expect(payload!['resonant']).toBe(true);
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

      const stateDir = config.stateDir ?? '.jeeves-metadata';
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

      // Search for "machine learning"
      const res = await server.inject({
        method: 'POST',
        url: '/search',
        payload: { query: 'machine learning', limit: 5 },
      });

      expect(res.statusCode).toBe(200);
      const results = JSON.parse(res.body) as Array<{
        id: string;
        score: number;
        payload: Record<string, unknown>;
      }>;

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);

      // With mock embeddings, we can't guarantee order, but we should get results
      const texts = results.map((r) => r.payload['chunk_text']);
      expect(
        texts.some((t) => typeof t === 'string' && t.includes('machine')),
      ).toBe(true);
    });
  });
});
