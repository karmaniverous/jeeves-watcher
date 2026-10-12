/**
 * @module processor/processorSystemFields.test
 * Rule properties with reserved names never overwrite system fields on files: rules re-apply (setPayload), upsert and move.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor } from './index';

vi.mock('./buildMetadata', () => ({ buildMergedMetadata: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  stat: vi.fn().mockResolvedValue({ birthtimeMs: 1000, mtimeMs: 2000 }),
  readFile: vi.fn().mockResolvedValue(Buffer.from('content')),
}));

import { buildMergedMetadata } from './buildMetadata';

/** Rule metadata that tries to claim reserved payload names. */
const HOSTILE = {
  domain: 'docs',
  file_path: 'evil',
  source: 'app://evil',
  source_rule: 'evil',
  chunk_text: 'evil',
  total_chunks: 99,
};

function setup() {
  const vectorStore = {
    getPayload: vi.fn().mockResolvedValue({ total_chunks: 1 }),
    upsert: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    setPayload: vi.fn().mockResolvedValue(undefined),
    getPointsWithVectors: vi
      .fn()
      .mockResolvedValue([
        { id: 'old', vector: [0.1], payload: { chunk_text: 'real' } },
      ]),
  };
  const embeddingProvider: EmbeddingProvider = {
    dimensions: 1,
    embed: vi.fn().mockResolvedValue([[0.1]]),
  };
  const processor = new DocumentProcessor({
    config: {},
    embeddingProvider,
    vectorStore: vectorStore as unknown as VectorStoreClient,
    compiledRules: [],
    logger: pino({ level: 'silent' }),
  });
  return { processor, vectorStore };
}

function expectSystemFieldsKept(payload: Record<string, unknown>) {
  expect(payload['domain']).toBe('docs');
  expect(payload['file_path']).toBe('/docs/a.txt');
  expect(payload).not.toHaveProperty('source');
  expect(payload).not.toHaveProperty('source_rule');
  expect(payload['chunk_text']).not.toBe('evil');
  expect(payload['total_chunks']).not.toBe(99);
}

describe('system fields are re-asserted for files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (buildMergedMetadata as Mock).mockResolvedValue({
      metadata: HOSTILE,
      extracted: { text: 'hello world' },
      renderedContent: null,
      matchedRules: ['r'],
      renderAs: null,
    });
  });

  it('on rules re-apply (setPayload)', async () => {
    const { processor, vectorStore } = setup();
    await processor.processRulesUpdate('/docs/a.txt');
    const payload = vectorStore.setPayload.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expectSystemFieldsKept(payload);
    expect(payload).not.toHaveProperty('chunk_text');
    expect(payload['matched_rules']).toEqual(['r']);
  });

  it('on upsert', async () => {
    const { processor, vectorStore } = setup();
    vectorStore.getPayload.mockResolvedValue(null);
    await processor.processFile('/docs/a.txt');
    const [point] = vectorStore.upsert.mock.calls[0][0] as Array<{
      payload: Record<string, unknown>;
    }>;
    expectSystemFieldsKept(point.payload);
    expect(point.payload['chunk_text']).toBe('hello world');
  });

  it('on move', async () => {
    const { processor, vectorStore } = setup();
    await processor.moveFile('/docs/old.txt', '/docs/a.txt');
    const [point] = vectorStore.upsert.mock.calls[0][0] as Array<{
      payload: Record<string, unknown>;
    }>;
    expectSystemFieldsKept(point.payload);
    expect(point.payload['chunk_text']).toBe('real');
  });
});
