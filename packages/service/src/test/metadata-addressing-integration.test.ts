/**
 * @module test/metadata-addressing-integration.test
 * Metadata writes against real Qdrant (D139, D154): with the file_path keyword index ready a POST /metadata updates every chunk by filter; with a text index on file_path (conflict) it uses existing IDs, and a document in the claim state (chunk 0 counting a high-water mark whose top IDs are missing, D105) updates every chunk it has.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pointId } from '../pointId';
import { qdrantAvailable, SETUP_IN_TEST_TIMEOUT_MS } from './harness/qdrant';
import {
  HARNESS_DIMENSIONS,
  type ServiceHarness,
  startServiceHarness,
} from './harness/service';

/** Text that splits into `n` chunks of the harness's 100-character chunk size. */
function textOfChunks(n: number): string {
  return Array.from({ length: n }, (_, i) =>
    `paragraph ${String(i)} `.padEnd(95, 'x'),
  ).join('\n\n');
}

const embedding = {
  provider: 'mock',
  model: 'mock',
  dimensions: HARNESS_DIMENSIONS,
  chunkSize: 100,
  chunkOverlap: 0,
  concurrency: 4,
  rateLimitPerMinute: 100000,
};

describe.skipIf(!qdrantAvailable())(
  'Metadata write addressing (requires Qdrant)',
  () => {
    let watchDir: string;
    const harnesses: ServiceHarness[] = [];

    beforeAll(async () => {
      watchDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-meta-'));
    });

    afterAll(async () => {
      for (const h of harnesses) await h.close();
      await rm(watchDir, { recursive: true, force: true });
    });

    async function harnessFor(
      label: string,
      payloadIndexes?: Array<{ field: string; type: 'text' }>,
    ): Promise<ServiceHarness> {
      const h = await startServiceHarness({
        label,
        payloadIndexes,
        config: {
          watch: { paths: [join(watchDir, '**/*')], ignored: [] },
          embedding,
        },
      });
      harnesses.push(h);
      return h;
    }

    /** Owners of chunks 0..n-1 (`null` for a missing point). */
    async function owners(
      h: ServiceHarness,
      file: string,
      n: number,
    ): Promise<unknown[]> {
      const payloads = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          h.vectorStore.getPayload(pointId(file, i)),
        ),
      );
      return payloads.map((p) => (p === null ? null : (p.owner ?? 'unset')));
    }

    async function setOwner(h: ServiceHarness, file: string, owner: string) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/metadata',
        payload: { path: file, metadata: { owner } },
      });
      expect(res.statusCode).toBe(200);
    }

    it(
      'updates every chunk by filter when file_path is keyword-indexed',
      async () => {
        const h = await harnessFor('meta_filter');
        expect(h.vectorStore.keywordIndexReady('file_path')).toBe(true);
        const file = join(watchDir, 'filter.md');
        await writeFile(file, textOfChunks(4), 'utf8');
        await h.processor.processFile(file);
        await setOwner(h, file, 'ann');
        expect(await owners(h, file, 4)).toEqual(['ann', 'ann', 'ann', 'ann']);
      },
      SETUP_IN_TEST_TIMEOUT_MS,
    );

    it(
      'uses existing IDs on a conflict and updates a claim-state document',
      async () => {
        const h = await harnessFor('meta_ids', [
          { field: 'file_path', type: 'text' },
        ]);
        expect(h.vectorStore.systemIndexStates()).toMatchObject({
          file_path: 'conflict',
        });
        const file = join(watchDir, 'claim.md');
        await writeFile(file, textOfChunks(5), 'utf8');
        await h.processor.processFile(file);
        // Simulate a streamed write that failed after window 0 of a 7-chunk
        // run: chunk 0 claims 7 and has no content hash; IDs 5 and 6 are missing.
        await h.vectorStore.setPayload([pointId(file, 0)], { total_chunks: 7 });
        await h.vectorStore.deletePayload([pointId(file, 0)], ['content_hash']);

        await setOwner(h, file, 'bob');
        expect(await owners(h, file, 7)).toEqual([
          'bob',
          'bob',
          'bob',
          'bob',
          'bob',
          null,
          null,
        ]);
      },
      SETUP_IN_TEST_TIMEOUT_MS,
    );
  },
);
