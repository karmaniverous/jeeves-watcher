/**
 * @module processor/processingPipeline.test
 * Tests for the embedAndUpsert pipeline — specifically batched upsert (#162).
 */

import { describe, expect, it, vi } from 'vitest';

import { embedAndUpsert } from './processingPipeline';

/** Build a minimal splitter that returns `count` fixed-length chunks. */
function makeSplitter(count: number) {
  const chunks = Array.from({ length: count }, (_, i) => `chunk-${String(i)}`);
  return { splitText: vi.fn().mockResolvedValue(chunks) };
}

/** Build a minimal embedding provider that returns a zero-vector per chunk. */
function makeEmbeddingProvider(chunkCount: number) {
  const vectors = Array.from({ length: chunkCount }, () => [0]);
  return { embed: vi.fn().mockResolvedValue(vectors) };
}

describe('embedAndUpsert — batched upsert (#162)', () => {
  it('calls upsert once for a small file (fewer than batch size chunks)', async () => {
    const chunks = 10;
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const deps = {
      embeddingProvider: makeEmbeddingProvider(chunks),
      vectorStore: { upsert: upsertMock, delete: vi.fn() },
      splitter: makeSplitter(chunks),
      logger: { info: vi.fn() } as never,
      upsertBatchSize: 50,
    };

    await embedAndUpsert(
      deps as never,
      'hello world',
      'test/file.md',
      {},
      null,
      { createdAt: 1000, modifiedAt: 2000 },
    );

    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0][0]).toHaveLength(chunks);
  });

  it('batches upsert when chunk count exceeds batch size', async () => {
    const chunks = 120;
    const batchSize = 50;
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const deps = {
      embeddingProvider: makeEmbeddingProvider(chunks),
      vectorStore: { upsert: upsertMock, delete: vi.fn() },
      splitter: makeSplitter(chunks),
      logger: { info: vi.fn() } as never,
      upsertBatchSize: batchSize,
    };

    await embedAndUpsert(
      deps as never,
      'hello world',
      'test/large.md',
      {},
      null,
      { createdAt: 1000, modifiedAt: 2000 },
    );

    // 120 chunks / 50 per batch = 3 calls (50 + 50 + 20)
    expect(upsertMock).toHaveBeenCalledTimes(3);
    expect(upsertMock.mock.calls[0][0]).toHaveLength(50);
    expect(upsertMock.mock.calls[1][0]).toHaveLength(50);
    expect(upsertMock.mock.calls[2][0]).toHaveLength(20);
  });

  it('uses default batch size of 50 when not specified', async () => {
    const chunks = 100;
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const deps = {
      embeddingProvider: makeEmbeddingProvider(chunks),
      vectorStore: { upsert: upsertMock, delete: vi.fn() },
      splitter: makeSplitter(chunks),
      logger: { info: vi.fn() } as never,
      // upsertBatchSize not provided — defaults to 50
    };

    await embedAndUpsert(
      deps as never,
      'hello world',
      'test/default.md',
      {},
      null,
      { createdAt: 1000, modifiedAt: 2000 },
    );

    // 100 chunks / 50 per batch = 2 calls
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });

  it('deletes orphaned chunks when new count is less than old count', async () => {
    const chunks = 5;
    const oldTotalChunks = 10;
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const deleteMock = vi.fn().mockResolvedValue(undefined);
    const deps = {
      embeddingProvider: makeEmbeddingProvider(chunks),
      vectorStore: { upsert: upsertMock, delete: deleteMock },
      splitter: makeSplitter(chunks),
      logger: { info: vi.fn() } as never,
    };

    await embedAndUpsert(
      deps as never,
      'hello world',
      'test/shrunk.md',
      {},
      // Simulate existing payload with 10 chunks
      { total_chunks: oldTotalChunks },
      { createdAt: 1000, modifiedAt: 2000 },
    );

    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('sends all points across batches (no points dropped)', async () => {
    const chunks = 73;
    const batchSize = 30;
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const deps = {
      embeddingProvider: makeEmbeddingProvider(chunks),
      vectorStore: { upsert: upsertMock, delete: vi.fn() },
      splitter: makeSplitter(chunks),
      logger: { info: vi.fn() } as never,
      upsertBatchSize: batchSize,
    };

    await embedAndUpsert(
      deps as never,
      'hello world',
      'test/points.md',
      {},
      null,
      { createdAt: 1000, modifiedAt: 2000 },
    );

    // 73 chunks / 30 per batch = 3 calls (30 + 30 + 13)
    const totalPointsUpserted = upsertMock.mock.calls.reduce(
      (sum, call) => sum + (call[0] as unknown[]).length,
      0,
    );
    expect(totalPointsUpserted).toBe(chunks);
  });
});
