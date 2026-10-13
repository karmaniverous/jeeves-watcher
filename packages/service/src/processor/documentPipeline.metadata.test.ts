/**
 * @module processor/documentPipeline.metadata.test
 * updateDocumentMetadata: one enrichment write path for files and sources: stored identity re-asserted, nothing stored for an unindexed source (files opt in), a failed payload write is an `upsert_error`.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { sourcePointId } from '../pointId';
import type { VectorStore } from '../vectorStore';
import { updateDocumentMetadata } from './documentPipeline';
import { ProcessingFailure } from './issueRecording';

const REF = 'app://chat/1';

function setup(stored: Record<string, unknown> | null) {
  const vectorStore = {
    getPayload: vi.fn().mockResolvedValue(stored),
    setPayload: vi.fn().mockResolvedValue(undefined),
  };
  const enrichment = new Map<string, Record<string, unknown>>();
  const enrichmentStore = {
    get: vi.fn((key: string) => enrichment.get(key) ?? null),
    set: vi.fn((key: string, m: Record<string, unknown>) => {
      enrichment.set(key, { ...enrichment.get(key), ...m });
    }),
    delete: vi.fn(),
    move: vi.fn(),
    list: vi.fn(),
    close: vi.fn(),
  };
  const ctx = {
    vectorStore: vectorStore as unknown as VectorStore,
    logger: pino({ level: 'silent' }),
    enrichmentStore,
  };
  return { ctx, vectorStore, enrichmentStore };
}

describe('updateDocumentMetadata', () => {
  it('writes merged enrichment with the stored designated rule to every chunk', async () => {
    const { ctx, vectorStore } = setup({
      source: REF,
      source_rule: 'chat',
      total_chunks: 2,
    });
    const merged = await updateDocumentMetadata(
      ctx,
      { kind: 'source', ref: REF },
      { priority: 1, source: 'hijack' },
    );
    expect(merged).toEqual({ priority: 1, source: 'hijack' });
    expect(vectorStore.setPayload).toHaveBeenCalledWith(
      [sourcePointId(REF, 0), sourcePointId(REF, 1)],
      { priority: 1, source: REF, source_rule: 'chat' },
    );
  });

  it('stores nothing for an unindexed source', async () => {
    const { ctx, enrichmentStore } = setup(null);
    expect(
      await updateDocumentMetadata(ctx, { kind: 'source', ref: REF }, { a: 1 }),
    ).toBeNull();
    expect(enrichmentStore.set).not.toHaveBeenCalled();
  });

  it('stores nothing for a source point without a designated rule', async () => {
    const { ctx, enrichmentStore, vectorStore } = setup({ source: REF });
    expect(
      await updateDocumentMetadata(ctx, { kind: 'source', ref: REF }, { a: 1 }),
    ).toBeNull();
    expect(enrichmentStore.set).not.toHaveBeenCalled();
    expect(vectorStore.setPayload).not.toHaveBeenCalled();
  });

  it('stores enrichment for an unindexed file when asked', async () => {
    const { ctx, enrichmentStore } = setup(null);
    const target = { kind: 'file', filePath: '/a.md' } as const;
    expect(
      await updateDocumentMetadata(
        ctx,
        target,
        { a: 1 },
        {
          storeWhenNotIndexed: true,
        },
      ),
    ).toBeNull();
    expect(enrichmentStore.set).toHaveBeenCalledWith('/a.md', { a: 1 });
  });

  it('tags a failed payload write as upsert_error', async () => {
    const { ctx, vectorStore } = setup({ source_rule: 'chat' });
    vectorStore.setPayload.mockRejectedValue(new Error('down'));
    const error: unknown = await updateDocumentMetadata(
      ctx,
      { kind: 'source', ref: REF },
      { a: 1 },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProcessingFailure);
    expect((error as ProcessingFailure).issueType).toBe('upsert_error');
  });
});
