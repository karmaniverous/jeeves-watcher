/**
 * @module processor/processingPipeline.stream.test
 * Streamed write with the chunk-0 claim (D87, #255): one window of 100 vectors at a time (each upserted before the next is embedded); chunk 0 first written with the high-water count and no content hash; a failure after window k leaves the claim (grow and shrink); on success the IDs from the new count to the high-water mark are deleted, then chunk 0 is finalised.
 */

import { describe, expect, it, vi } from 'vitest';

import { pointId } from '../pointId';
import { ProcessingFailure } from './issueRecording';
import { embedAndUpsertDocument } from './processingPipeline';

const FILE = 'docs/stream.md';

interface StoredPoint {
  payload: Record<string, unknown>;
}

/** An in-memory store recording the order of calls. */
function memoryStore(initial: Record<string, Record<string, unknown>> = {}) {
  const points = new Map<string, StoredPoint>(
    Object.entries(initial).map(([id, payload]) => [id, { payload }]),
  );
  const calls: string[] = [];
  return {
    points,
    calls,
    store: {
      upsert: vi.fn(
        (batch: Array<{ id: string; payload: Record<string, unknown> }>) => {
          calls.push(`upsert:${String(batch.length)}`);
          for (const p of batch) points.set(p.id, { payload: p.payload });
          return Promise.resolve();
        },
      ),
      delete: vi.fn((ids: string[]) => {
        calls.push(`delete:${String(ids.length)}`);
        for (const id of ids) points.delete(id);
        return Promise.resolve();
      }),
      setPayload: vi.fn((ids: string[], payload: Record<string, unknown>) => {
        calls.push('finalise');
        for (const id of ids) {
          const p = points.get(id);
          if (p) p.payload = { ...p.payload, ...payload };
        }
        return Promise.resolve();
      }),
    },
  };
}

/** An embedder that fails on call number `failOn` (1-based), if given. */
function embedder(calls: string[], failOn?: number) {
  let n = 0;
  return {
    embed: vi.fn((texts: string[]) => {
      n++;
      calls.push(`embed:${String(texts.length)}`);
      if (n === failOn) return Promise.reject(new Error('provider down'));
      return Promise.resolve(texts.map(() => [0]));
    }),
  };
}

function chunksOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `chunk ${String(i)}`);
}

async function write(
  mem: ReturnType<typeof memoryStore>,
  total: number,
  existing: Record<string, unknown> | null,
  failOn?: number,
): Promise<unknown> {
  const embeddingProvider = embedder(mem.calls, failOn);
  const result = await embedAndUpsertDocument(
    {
      embeddingProvider,
      vectorStore: mem.store,
      logger: { info: vi.fn() },
      upsertBatchSize: 1000,
    } as never,
    {
      identity: { kind: 'file', filePath: FILE },
      text: chunksOf(total).join('\n'),
      metadata: {},
      logLabel: 'File',
    },
    {
      existing,
      dates: { createdAt: 1, modifiedAt: 2 },
      hash: 'new-hash',
      chunks: chunksOf(total),
    },
  ).catch((error: unknown) => error);
  return result;
}

const id = (i: number) => pointId(FILE, i);

/** Indexes of the stored points of FILE, ascending. */
function storedIndexes(mem: ReturnType<typeof memoryStore>, upTo: number) {
  return Array.from({ length: upTo }, (_, i) => i).filter((i) =>
    mem.points.has(id(i)),
  );
}

describe('embedAndUpsertDocument streamed write (D87)', () => {
  it('embeds and upserts one window at a time, never more than 100 vectors', async () => {
    const mem = memoryStore();
    expect(await write(mem, 250, null)).toBe(250);
    expect(mem.calls).toEqual([
      'embed:100',
      'upsert:100',
      'embed:100',
      'upsert:100',
      'embed:50',
      'upsert:50',
      'finalise',
    ]);
    expect(mem.points.get(id(0))?.payload).toMatchObject({
      total_chunks: 250,
      content_hash: 'new-hash',
    });
  });

  it('a growing write failing after window k leaves the claim: high-water count, no hash', async () => {
    const mem = memoryStore({
      [id(0)]: { total_chunks: 2, content_hash: 'old' },
      [id(1)]: { total_chunks: 2, content_hash: 'old' },
    });
    const error = await write(
      mem,
      250,
      { total_chunks: 2, content_hash: 'old' },
      3,
    );
    expect(error).toBeInstanceOf(ProcessingFailure);
    expect((error as ProcessingFailure).issueType).toBe('embedding_error');
    const chunk0 = mem.points.get(id(0))?.payload;
    expect(chunk0?.total_chunks).toBe(250);
    expect(chunk0).not.toHaveProperty('content_hash');
    expect(storedIndexes(mem, 300)).toEqual(
      Array.from({ length: 200 }, (_, i) => i),
    );
    expect(mem.calls).not.toContain('finalise');
  });

  it('a shrinking write failing after window k keeps the old high-water count', async () => {
    const initial: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 300; i++) {
      initial[id(i)] = { total_chunks: 300, content_hash: 'old' };
    }
    const mem = memoryStore(initial);
    await write(mem, 150, { total_chunks: 300, content_hash: 'old' }, 2);
    const chunk0 = mem.points.get(id(0))?.payload;
    expect(chunk0?.total_chunks).toBe(300);
    expect(chunk0).not.toHaveProperty('content_hash');
    // Nothing deleted yet: every ID below the claim is still reachable.
    expect(storedIndexes(mem, 400)).toHaveLength(300);

    // The retry succeeds: no point at or above the final count remains.
    const claim = { ...chunk0 };
    expect(await write(mem, 150, claim)).toBe(150);
    expect(storedIndexes(mem, 400)).toEqual(
      Array.from({ length: 150 }, (_, i) => i),
    );
    expect(mem.points.get(id(0))?.payload).toMatchObject({
      total_chunks: 150,
      content_hash: 'new-hash',
    });
  });

  it('deletes from the new count to the high-water mark before finalising', async () => {
    const initial: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 7; i++) initial[id(i)] = { total_chunks: 7 };
    const mem = memoryStore(initial);
    // Chunk 0 in the claim state of an earlier failed run (no hash).
    expect(await write(mem, 3, { total_chunks: 7 })).toBe(3);
    expect(mem.calls.slice(-2)).toEqual(['delete:4', 'finalise']);
    expect(storedIndexes(mem, 10)).toEqual([0, 1, 2]);
  });

  it('writes chunk 0 with the claim and the other chunks with the hash and new count', async () => {
    const mem = memoryStore();
    const upserts: Array<Array<{ payload: Record<string, unknown> }>> = [];
    mem.store.upsert.mockImplementation((batch) => {
      upserts.push(batch);
      return Promise.resolve();
    });
    await write(mem, 3, { total_chunks: 5, content_hash: 'old' });
    const payloads = upserts.flat().map((p) => p.payload);
    expect(payloads[0].total_chunks).toBe(5);
    expect(payloads[0]).not.toHaveProperty('content_hash');
    expect(payloads[1]).toMatchObject({
      total_chunks: 3,
      content_hash: 'new-hash',
    });
    expect(mem.store.setPayload).toHaveBeenCalledWith([id(0)], {
      content_hash: 'new-hash',
      total_chunks: 3,
    });
  });

  it('an empty chunk list deletes the old points and finalises nothing', async () => {
    const mem = memoryStore({ [id(0)]: { total_chunks: 2 }, [id(1)]: {} });
    expect(await write(mem, 0, { total_chunks: 2 })).toBe(0);
    expect(mem.points.size).toBe(0);
    expect(mem.store.setPayload).not.toHaveBeenCalled();
  });
});
