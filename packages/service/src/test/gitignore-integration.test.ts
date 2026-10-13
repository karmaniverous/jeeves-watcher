/**
 * @module test/gitignore-integration.test
 * File integration (requires Qdrant): with a GitignoreFilter applied, only non-ignored files of a fake repo are indexed. Uses a guarded harness collection on the run's Qdrant.
 */

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
  assertTestVectorStore,
  dropCollection,
  qdrantAvailable,
  uniqueCollectionName,
} from './harness/qdrant';
import {
  cleanupWatchedDir,
  createTestConfig,
  getWatchDir,
  setupTestDirs,
} from './helpers';

describe.skipIf(!qdrantAvailable())(
  'Gitignore integration tests (requires Qdrant)',
  () => {
    const config = createTestConfig();
    // Use a separate, unique `jeeves_watcher_it_` collection: no conflicts
    // with parallel test files, never a shared Qdrant's data.
    config.vectorStore.collectionName = uniqueCollectionName('gitignore');
    const embeddingProvider = createEmbeddingProvider(config.embedding);
    const logger = createLogger({ level: 'silent' });

    let vectorStore: VectorStoreClient;
    let processor: DocumentProcessor;

    beforeAll(async () => {
      assertTestVectorStore(config.vectorStore);
      vectorStore = new VectorStoreClient(
        config.vectorStore,
        embeddingProvider.dimensions,
      );
      await vectorStore.ensureCollection();

      const compiledRules = compileRules(config.inferenceRules ?? []);
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
      });
    });

    afterAll(async () => {
      await dropCollection(config.vectorStore.collectionName);
    });

    beforeEach(async () => {
      await setupTestDirs();
    });

    afterEach(async () => {
      await dropCollection(config.vectorStore.collectionName);
      await vectorStore.ensureCollection();
      await cleanupWatchedDir();
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

        // The tracked file is indexed (the ignored ones were never processed).
        const trackedPayload = await vectorStore.getPayload(
          pointId(trackedFile, 0),
        );
        expect(trackedPayload).not.toBeNull();
        expect(trackedPayload!['chunk_text']).toContain('hello');
      });
    });
  },
);
