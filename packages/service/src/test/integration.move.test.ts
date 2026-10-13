/**
 * @module test/integration.move.test
 * File integration (requires Qdrant), pre-0.20.0 suite: moving a file keeps its vectors and enrichment; enrichment survives re-embedding. Shared setup: {@link useLegacyIntegration}.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { EnrichmentStore } from '../enrichment';
import { pointId } from '../pointId';
import type { DocumentProcessor } from '../processor';
import type { VectorStoreClient } from '../vectorStore';
import { qdrantAvailable } from './harness/qdrant';
import { getWatchDir } from './helpers';
import { useLegacyIntegration } from './legacyIntegration';

describe.skipIf(!qdrantAvailable())(
  'Integration tests (requires Qdrant)',
  () => {
    const fixture = useLegacyIntegration();
    let vectorStore: VectorStoreClient;
    let processor: DocumentProcessor;
    let enrichmentStore: EnrichmentStore;

    beforeAll(() => {
      ({ vectorStore, processor, enrichmentStore } = fixture);
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
  },
);
