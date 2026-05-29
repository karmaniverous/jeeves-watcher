/**
 * @module processor/processingPipeline.test
 * Tests for the embedAndUpsert pipeline — batched upsert (#162) and embedding batch splitting (#186).
 */

import { describe, expect, it, vi } from 'vitest';

import { embedAndUpsert } from './processingPipeline';

/** Build a minimal splitter that returns `count` fixed-length chunks. */
function makeSplitter(count: number) {
  const chunks = Array.from({ length: count }, (_, i) => `chunk-${String(i)}`);
  return { splitText: vi.fn().mockResolvedValue(chunks) };
}

/** Build a minimal embedding provider that returns a zero-vector per input text. */
function makeEmbeddingProvider() {
  return {
    embed: vi
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [0])),
      ),
  };
}

describe('embedAndUpsert — batched upsert (#162)', () => {
  it('calls upsert once for a small file (fewer than batch size chunks)', async () => {
    const chunks = 10;
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const deps = {
      embeddingProvider: makeEmbeddingProvider(),
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
      embeddingProvider: makeEmbeddingProvider(),
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
      embeddingProvider: makeEmbeddingProvider(),
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
      embeddingProvider: makeEmbeddingProvider(),
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
      embeddingProvider: makeEmbeddingProvider(),
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

describe('embedAndUpsert — embedding batch splitting (#186)', () => {
  it('calls embed twice when chunk count exceeds 100', async () => {
    const chunks = 150;
    const embeddingProvider = makeEmbeddingProvider();
    const deps = {
      embeddingProvider,
      vectorStore: {
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      },
      splitter: makeSplitter(chunks),
      logger: { info: vi.fn() } as never,
    };

    await embedAndUpsert(
      deps as never,
      'hello world',
      'test/large.md',
      {},
      null,
      { createdAt: 1000, modifiedAt: 2000 },
    );

    // 150 chunks → 2 embed calls (100 + 50)
    expect(embeddingProvider.embed).toHaveBeenCalledTimes(2);
    expect(embeddingProvider.embed.mock.calls[0][0]).toHaveLength(100);
    expect(embeddingProvider.embed.mock.calls[1][0]).toHaveLength(50);
  });

  it('calls embed once when chunk count is exactly 100', async () => {
    const chunks = 100;
    const embeddingProvider = makeEmbeddingProvider();
    const deps = {
      embeddingProvider,
      vectorStore: {
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      },
      splitter: makeSplitter(chunks),
      logger: { info: vi.fn() } as never,
    };

    await embedAndUpsert(
      deps as never,
      'hello world',
      'test/exact.md',
      {},
      null,
      { createdAt: 1000, modifiedAt: 2000 },
    );

    expect(embeddingProvider.embed).toHaveBeenCalledTimes(1);
    expect(embeddingProvider.embed.mock.calls[0][0]).toHaveLength(100);
  });

  it('assembles vectors in correct order across batches', async () => {
    const chunks = 150;
    let callIndex = 0;
    const embeddingProvider = {
      embed: vi.fn().mockImplementation((texts: string[]) => {
        const base = callIndex * 100;
        callIndex++;
        return Promise.resolve(texts.map((_, i) => [base + i]));
      }),
    };
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const deps = {
      embeddingProvider,
      vectorStore: { upsert: upsertMock, delete: vi.fn() },
      splitter: makeSplitter(chunks),
      logger: { info: vi.fn() } as never,
    };

    await embedAndUpsert(
      deps as never,
      'hello world',
      'test/order.md',
      {},
      null,
      { createdAt: 1000, modifiedAt: 2000 },
    );

    // Verify all 150 points were upserted with correctly ordered vectors
    const allPoints = upsertMock.mock.calls.flatMap(
      (call) => call[0] as Array<{ vector: number[] }>,
    );
    expect(allPoints).toHaveLength(150);
    // First point vector should be [0], 100th should be [99], 101st should be [100]
    expect(allPoints[0].vector).toEqual([0]);
    expect(allPoints[99].vector).toEqual([99]);
    expect(allPoints[100].vector).toEqual([100]);
    expect(allPoints[149].vector).toEqual([149]);
  });
});
