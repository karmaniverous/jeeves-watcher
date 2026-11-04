/**
 * @module test/document-lock-integration.test
 * Per-document locks against real Qdrant and the real API (D98, D118): POST /metadata answers 503 with Retry-After: 10 while the document is locked and changes nothing, then succeeds once the lock frees; two overlapping runs of one file (the first read 20 chunks and is held in embedding when the 8-chunk event arrives) are serialised and leave no chunk at or above the final count.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
import { pointId } from '../pointId';
import { fileLockKey } from '../processor/DocumentLocks';
import { qdrantAvailable } from './harness/qdrant';
import {
  HARNESS_DIMENSIONS,
  type ServiceHarness,
  startServiceHarness,
} from './harness/service';

/** A promise with its resolver. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The next embed call signals `reached`, then waits for `release`. */
let embedHold:
  | {
      reached: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
    }
  | undefined;

/** Hold the next embed call while {@link embedHold} is set. */
function holdable(provider: EmbeddingProvider): EmbeddingProvider {
  return {
    dimensions: provider.dimensions,
    embed: async (texts, options) => {
      const hold = embedHold;
      embedHold = undefined;
      if (hold) {
        hold.reached.resolve();
        await hold.release.promise;
      }
      return provider.embed(texts, options);
    },
  };
}

/** Text that splits into `n` chunks of the harness's 100-character chunk size. */
function textOfChunks(n: number, tag: string): string {
  return Array.from({ length: n }, (_, i) =>
    `${tag} paragraph ${String(i)} `.padEnd(95, 'x'),
  ).join('\n\n');
}

describe.skipIf(!qdrantAvailable())(
  'Per-document locks (requires Qdrant)',
  () => {
    let harness: ServiceHarness;
    let watchDir: string;
    let file: string;

    beforeAll(async () => {
      watchDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-lock-'));
      file = join(watchDir, 'doc.md');
      await writeFile(file, 'hello lock', 'utf8');
      harness = await startServiceHarness({
        label: 'doc_lock',
        documentLockWaitMs: 300,
        wrapEmbedding: holdable,
        config: {
          watch: { paths: [join(watchDir, '**/*')], ignored: [] },
          embedding: {
            provider: 'mock',
            model: 'mock',
            dimensions: HARNESS_DIMENSIONS,
            chunkSize: 100,
            chunkOverlap: 0,
            concurrency: 4,
            rateLimitPerMinute: 100000,
          },
        },
      });
      await harness.processor.processFile(file);
    });

    afterAll(async () => {
      await harness.close();
      await rm(watchDir, { recursive: true, force: true });
    });

    it('POST /metadata answers 503 + Retry-After: 10 while locked, then succeeds', async () => {
      const gate = deferred();
      const holder = harness.documentLocks.run(
        fileLockKey(file),
        'test-hold',
        () => gate.promise,
      );
      const busy = await harness.app.inject({
        method: 'POST',
        url: '/metadata',
        payload: { path: file, metadata: { owner: 'busy' } },
      });
      expect(busy.statusCode).toBe(503);
      expect(busy.headers['retry-after']).toBe('10');
      expect(busy.json()).toMatchObject({ code: 'not_available' });
      const unchanged = await harness.vectorStore.getPayload(pointId(file, 0));
      expect(unchanged?.owner).toBeUndefined();
      expect(harness.enrichmentStore.get(file)).toBeNull();

      gate.resolve();
      await holder;
      const ok = await harness.app.inject({
        method: 'POST',
        url: '/metadata',
        payload: { path: file, metadata: { owner: 'free' } },
      });
      expect(ok.statusCode).toBe(200);
      const updated = await harness.vectorStore.getPayload(pointId(file, 0));
      expect(updated?.owner).toBe('free');
    });

    it('two overlapping runs (20 then 8 chunks) are serialised and leak no chunk', async () => {
      const big = join(watchDir, 'shrink.md');
      await writeFile(big, textOfChunks(20, 'first'), 'utf8');
      const hold = { reached: deferred(), release: deferred() };
      embedHold = hold;
      const first = harness.processor.processFile(big);
      // The first run has read all 20 chunks and is embedding them.
      await hold.reached.promise;
      // The second event arrives while the first run is still processing.
      await writeFile(big, textOfChunks(8, 'second'), 'utf8');
      const second = harness.processor.processFile(big);
      // Let the second run go as far as it can before the first resumes.
      await new Promise((resolve) => setTimeout(resolve, 200));
      hold.release.resolve();
      await Promise.all([first, second]);

      const chunk0 = await harness.vectorStore.getPayload(pointId(big, 0));
      expect(chunk0?.total_chunks).toBe(8);
      expect(typeof chunk0?.content_hash).toBe('string');
      const present = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          harness.vectorStore.getPayload(pointId(big, i)),
        ),
      );
      expect(present.map((p) => p !== null)).toEqual(
        Array.from({ length: 30 }, (_, i) => i < 8),
      );
    });
  },
);
