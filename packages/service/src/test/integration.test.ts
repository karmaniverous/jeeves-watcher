/**
 * @module test/integration.test
 * File integration (requires Qdrant), pre-0.20.0 suite: add, update, delete, metadata update, and rule inference for a watched file. Shared setup: {@link useLegacyIntegration}.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { pointId } from '../pointId';
import { DocumentProcessor } from '../processor';
import { compileRules } from '../rules';
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

    beforeAll(() => {
      ({ vectorStore, processor } = fixture);
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
        const embed = vi.spyOn(embeddingProvider, 'embed');
        onTestFinished(() => {
          embed.mockRestore();
        });

        // Process again — should skip (content hash matches)
        await processor.processFile(filePath);

        expect(embed).not.toHaveBeenCalled();
        const payload2 = await vectorStore.getPayload(id);
        expect(payload2).toEqual(payload1);
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
        const embed = vi.spyOn(embeddingProvider, 'embed');
        onTestFinished(() => {
          embed.mockRestore();
        });

        await processor.processMetadataUpdate(filePath, {
          title: 'Test Document',
          labels: ['test'],
        });

        const payloadAfter = await vectorStore.getPayload(id);
        expect(embed).not.toHaveBeenCalled();
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
  },
);
