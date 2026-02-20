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

import { createEmbeddingProvider } from '../embedding';
import { createLogger } from '../logger';
import { pointId } from '../pointId';
import { DocumentProcessor } from '../processor';
import { compileRules } from '../rules';
import { VectorStoreClient } from '../vectorStore';
import {
  cleanupTestDirs,
  createTestConfig,
  getWatchDir,
  setupTestDirs,
} from './helpers';

const config = createTestConfig();
let vectorStore: VectorStoreClient;
let processor: DocumentProcessor;

beforeAll(async () => {
  const embeddingProvider = createEmbeddingProvider(config.embedding);
  vectorStore = new VectorStoreClient(
    config.vectorStore,
    embeddingProvider.dimensions,
  );

  // Drop collection if it exists, then create fresh
  try {
    await vectorStore.delete([]); // no-op, just to test connection
  } catch {
    // ignore
  }

  // Use raw Qdrant client to ensure clean collection
  const url = config.vectorStore.url;
  const collectionName = config.vectorStore.collectionName;
  try {
    await fetch(`${url}/collections/${collectionName}`, { method: 'DELETE' });
  } catch {
    // ignore
  }
  await vectorStore.ensureCollection();

  const logger = createLogger({ level: 'silent' });
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

    const embeddingProvider = createEmbeddingProvider(config.embedding);
    const logger = createLogger({ level: 'silent' });
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
