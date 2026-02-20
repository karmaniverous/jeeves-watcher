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
import { createLogger } from '../logger';
import { readMetadata } from '../metadata';
import { pointId } from '../pointId';
import { DocumentProcessor } from '../processor';
import { EventQueue } from '../queue';
import { compileRules } from '../rules';
import { VectorStoreClient } from '../vectorStore';
import {
  cleanupTestDirs,
  createTestConfig,
  getWatchDir,
  setupTestDirs,
} from './helpers';

const config = createTestConfig();
const embeddingProvider = createEmbeddingProvider(config.embedding);
const logger = createLogger({ level: 'silent' });

let vectorStore: VectorStoreClient;
let processor: DocumentProcessor;

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

  processor = new DocumentProcessor(
    config,
    embeddingProvider,
    vectorStore,
    compiledRules,
    logger,
  );
});

afterAll(async () => {
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
  await cleanupTestDirs();
});

describe('File add', () => {
  it('should index a new file with correct payload fields', async () => {
    const filePath = join(getWatchDir(), 'test.txt');
    await writeFile(filePath, 'Hello world, this is a test document.', 'utf8');

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
  it('POST /reindex should index files from watched dirs', async () => {
    const filePath1 = join(getWatchDir(), 'api-1.txt');
    const filePath2 = join(getWatchDir(), 'api-2.txt');
    await writeFile(filePath1, 'First file', 'utf8');
    await writeFile(filePath2, 'Second file', 'utf8');

    const server = createApiServer({
      processor,
      vectorStore,
      embeddingProvider,
      queue: new EventQueue({ debounceMs: 0, concurrency: 1 }),
      config,
      logger,
    });

    const res = await server.inject({ method: 'POST', url: '/reindex' });
    expect(res.statusCode).toBe(200);

    expect(await vectorStore.getPayload(pointId(filePath1, 0))).not.toBeNull();
    expect(await vectorStore.getPayload(pointId(filePath2, 0))).not.toBeNull();
  });

  it('POST /rebuild-metadata should write meta files from Qdrant payloads', async () => {
    const filePath = join(getWatchDir(), 'rebuild.txt');
    await writeFile(filePath, 'Rebuild metadata content', 'utf8');
    await processor.processFile(filePath);
    await processor.processMetadataUpdate(filePath, { title: 'Rebuilt Title' });

    const server = createApiServer({
      processor,
      vectorStore,
      embeddingProvider,
      queue: new EventQueue({ debounceMs: 0, concurrency: 1 }),
      config,
      logger,
    });

    const res = await server.inject({
      method: 'POST',
      url: '/rebuild-metadata',
    });
    expect(res.statusCode).toBe(200);

    const meta = await readMetadata(
      filePath,
      config.metadataDir ?? '.jeeves-metadata',
    );
    expect(meta).not.toBeNull();
    expect(meta!['title']).toBe('Rebuilt Title');
  });

  it('POST /config-reindex should start reindex asynchronously', async () => {
    const server = createApiServer({
      processor,
      vectorStore,
      embeddingProvider,
      queue: new EventQueue({ debounceMs: 0, concurrency: 1 }),
      config,
      logger,
    });

    const res = await server.inject({
      method: 'POST',
      url: '/config-reindex',
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
          match: {
            properties: {
              file: {
                properties: {
                  path: { type: 'string' as const, glob: '**/meetings/**' },
                },
              },
            },
          },
          set: { domain: 'meetings' },
        },
      ],
    };

    const compiledRules = compileRules(rulesConfig.inferenceRules);
    const rulesProcessor = new DocumentProcessor(
      rulesConfig,
      embeddingProvider,
      vectorStore,
      compiledRules,
      logger,
    );

    await rulesProcessor.processFile(filePath);

    const id = pointId(filePath, 0);
    const payload = await vectorStore.getPayload(id);
    expect(payload).not.toBeNull();
    expect(payload!['domain']).toBe('meetings');
  });
});
