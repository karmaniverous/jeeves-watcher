import { mkdir, writeFile } from 'node:fs/promises';
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
import { GitignoreFilter } from '../gitignore';
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
// Use a separate collection to avoid conflicts with parallel test files
config.vectorStore.collectionName = 'jeeves_watcher_test_gitignore';
const embeddingProvider = createEmbeddingProvider(config.embedding);
const logger = createLogger({ level: 'silent' });

let vectorStore: VectorStoreClient;
let processor: DocumentProcessor;

beforeAll(async () => {
  vectorStore = new VectorStoreClient(
    config.vectorStore,
    embeddingProvider.dimensions,
  );

  const url = config.vectorStore.url;
  const collectionName = config.vectorStore.collectionName;
  try {
    await fetch(`${url}/collections/${collectionName}`, { method: 'DELETE' });
  } catch {
    // ignore
  }
  await vectorStore.ensureCollection();

  const compiledRules = compileRules(config.inferenceRules ?? []);
  const processorConfig = {
    metadataDir: config.metadataDir ?? '.jeeves-metadata',
    chunkSize: config.embedding.chunkSize,
    chunkOverlap: config.embedding.chunkOverlap,
    maps: config.maps,
  };

  processor = new DocumentProcessor(
    processorConfig,
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

describe('Gitignore filtering integration', () => {
  it('should only index non-ignored files when filter is applied', async () => {
    const watchDir = getWatchDir();

    // Create a fake git repo structure
    await mkdir(join(watchDir, '.git'), { recursive: true });
    await writeFile(join(watchDir, '.gitignore'), '*.log\ndist/\n', 'utf8');

    // Create files: one tracked, two ignored
    await mkdir(join(watchDir, 'src'), { recursive: true });
    await mkdir(join(watchDir, 'dist'), { recursive: true });

    const trackedFile = join(watchDir, 'src', 'index.ts');
    const ignoredLog = join(watchDir, 'error.log');
    const ignoredDist = join(watchDir, 'dist', 'bundle.js');

    await writeFile(trackedFile, 'export const hello = "world";', 'utf8');
    await writeFile(ignoredLog, 'ERROR: something broke', 'utf8');
    await writeFile(ignoredDist, 'var x=1;', 'utf8');

    // Create GitignoreFilter scoped to watchDir
    const filter = new GitignoreFilter([watchDir]);

    // Verify filter decisions
    expect(filter.isIgnored(trackedFile)).toBe(false);
    expect(filter.isIgnored(ignoredLog)).toBe(true);
    expect(filter.isIgnored(ignoredDist)).toBe(true);

    // Process only non-ignored files (mirrors watcher behavior)
    const allFiles = [trackedFile, ignoredLog, ignoredDist];
    for (const filePath of allFiles) {
      if (!filter.isIgnored(filePath)) {
        await processor.processFile(filePath);
      }
    }

    // Verify Qdrant state: only tracked file indexed
    const trackedPayload = await vectorStore.getPayload(
      pointId(trackedFile, 0),
    );
    expect(trackedPayload).not.toBeNull();
    expect(trackedPayload!['chunk_text']).toContain('hello');

    const logPayload = await vectorStore.getPayload(pointId(ignoredLog, 0));
    expect(logPayload).toBeNull();

    const distPayload = await vectorStore.getPayload(pointId(ignoredDist, 0));
    expect(distPayload).toBeNull();
  });
});
