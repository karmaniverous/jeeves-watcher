/**
 * @module test/streamed-write-integration.test
 * Streamed write against real Qdrant (D87, #255): a new 250-chunk file whose second embedding window fails is left as a chunk-0 claim (high-water count, no hash), is never unchanged, and an unlink then deletes every written point; a retry after recovery indexes it fully.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
import { pointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
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

describe.skipIf(!qdrantAvailable())('Streamed write (requires Qdrant)', () => {
  let harness: ServiceHarness;
  let watchDir: string;
  /** Embedding calls to fail (1-based call numbers). */
  const failCalls = new Set<number>();
  let embedCalls = 0;

  beforeAll(async () => {
    watchDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-stream-'));
    harness = await startServiceHarness({
      label: 'stream',
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
      wrapEmbedding: (inner): EmbeddingProvider => ({
        dimensions: inner.dimensions,
        embed: (texts, options) => {
          embedCalls++;
          if (failCalls.has(embedCalls)) {
            return Promise.reject(new Error('provider down'));
          }
          return inner.embed(texts, options);
        },
      }),
    });
  });

  afterAll(async () => {
    await harness.close();
    await rm(watchDir, { recursive: true, force: true });
  });

  async function present(file: string, upTo: number): Promise<number[]> {
    const payloads = await Promise.all(
      Array.from({ length: upTo }, (_, i) =>
        harness.vectorStore.getPayload(pointId(file, i)),
      ),
    );
    return payloads.flatMap((p, i) => (p === null ? [] : [i]));
  }

  it('a new file failing mid-stream is a claim, and an unlink deletes every written point', async () => {
    const file = join(watchDir, 'big-new.md');
    await writeFile(file, textOfChunks(250), 'utf8');
    failCalls.add(embedCalls + 2);
    await harness.processor.processFile(file);

    const chunk0 = await harness.vectorStore.getPayload(pointId(file, 0));
    expect(chunk0?.total_chunks).toBe(250);
    expect(chunk0).not.toHaveProperty('content_hash');
    expect(await present(file, 260)).toEqual(
      Array.from({ length: 100 }, (_, i) => i),
    );
    expect(harness.issuesManager.getAll()[file]?.map((i) => i.type)).toEqual([
      'embedding_error',
    ]);

    await harness.processor.deleteFile(file);
    expect(await present(file, 260)).toEqual([]);
  });

  it('a claim is never unchanged: the next run indexes the file fully', async () => {
    const file = join(watchDir, 'big-retry.md');
    await writeFile(file, textOfChunks(250), 'utf8');
    failCalls.add(embedCalls + 3);
    await harness.processor.processFile(file);
    expect(await present(file, 260)).toHaveLength(200);

    await harness.processor.processFile(file);
    const chunk0 = await harness.vectorStore.getPayload(pointId(file, 0));
    expect(chunk0?.total_chunks).toBe(250);
    expect(typeof chunk0?.content_hash).toBe('string');
    expect(await present(file, 260)).toHaveLength(250);
    expect(harness.issuesManager.getAll()[file]).toBeUndefined();
  });
});
