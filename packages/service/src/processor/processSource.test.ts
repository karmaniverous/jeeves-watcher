/**
 * @module processor/processSource.test
 * DocumentProcessor.processSource: source point IDs/payload, created_at on replace, unchanged and metadata-only updates, 404 delete, failures as issues.
 */

import pino from 'pino';
import { describe, expect, it, type Mock, vi } from 'vitest';

import type { InferenceRule } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import type { IssuesManager } from '../issues';
import { pointId, sourcePointId } from '../pointId';
import { compileRules } from '../rules';
import type { SourceRetrievalResult, SourceRetriever } from '../sources';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor } from './index';

const REF = 'app://chat/thread/AbC';
const OP = { operation: 'Failed to process source document' };
const BODY = { userId: 'u1', content: 'hello world' };

const rules: InferenceRule[] = [
  {
    name: 'chat',
    description: 'Chat',
    match: { type: 'object', required: ['source', 'json'] },
    schema: [
      {
        type: 'object',
        properties: {
          user_id: { type: 'string', set: '{{json.userId}}' },
          file_path: { type: 'string', set: 'evil' },
          source: { type: 'string', set: 'evil' },
        },
      },
    ],
  },
];

interface Mocks {
  getPayload: Mock;
  upsert: Mock;
  delete: Mock;
  setPayload: Mock;
  embed: Mock;
  record: Mock;
  clear: Mock;
  retrieve: Mock;
}

function setup(
  result: SourceRetrievalResult = { kind: 'document', body: BODY },
  existing: Record<string, unknown> | null = null,
) {
  const mocks: Mocks = {
    getPayload: vi.fn().mockResolvedValue(existing),
    upsert: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    setPayload: vi.fn().mockResolvedValue(undefined),
    embed: vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [0.1]))),
    record: vi.fn(),
    clear: vi.fn(),
    retrieve: vi.fn().mockResolvedValue(result),
  };
  const retriever: SourceRetriever = {
    has: () => true,
    resolve: vi.fn(),
    retrieve: mocks.retrieve,
  };
  const embeddingProvider: EmbeddingProvider = {
    dimensions: 1,
    embed: mocks.embed,
  };
  const enrichmentStore = {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  };
  const processor = new DocumentProcessor({
    config: { chunkSize: 1000, chunkOverlap: 0 },
    embeddingProvider,
    vectorStore: mocks as unknown as VectorStoreClient,
    compiledRules: compileRules(rules),
    logger: pino({ level: 'silent' }),
    enrichmentStore,
    issuesManager: {
      record: mocks.record,
      clear: mocks.clear,
      get: vi.fn(),
    } as unknown as IssuesManager,
    sourceRetriever: retriever,
  });
  return { processor, mocks, enrichmentStore };
}

/** The chunk-0 payload a previous indexing of BODY would have stored. */
function storedPayload(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'u1',
    matched_rules: ['chat'],
    source: REF,
    source_rule: 'chat',
    content_hash: contentHash('hello world'),
    total_chunks: 1,
    chunk_index: 0,
    chunk_text: 'hello world',
    created_at: 100,
    modified_at: 200,
    line_start: 1,
    line_end: 1,
    ...overrides,
  };
}

type UpsertedPoint = { id: string; payload: Record<string, unknown> };

describe('DocumentProcessor.processSource', () => {
  it('indexes a source document with source identity and no file_path', async () => {
    const { processor, mocks } = setup();
    const result = await processor.processSource(REF, 'chat');

    expect(result).toEqual({
      source: REF,
      status: 'indexed',
      chunks: 1,
      matched_rules: ['chat'],
    });
    const [point] = mocks.upsert.mock.calls[0][0] as UpsertedPoint[];
    expect(point.id).toBe(sourcePointId(REF, 0));
    expect(point.payload).toMatchObject({
      source: REF,
      source_rule: 'chat',
      user_id: 'u1',
      chunk_text: 'hello world',
      matched_rules: ['chat'],
    });
    expect(point.payload).not.toHaveProperty('file_path');
    expect(mocks.clear).toHaveBeenCalledWith(REF);
  });

  it('keys points by the exact reference (case-sensitive, not normalised)', async () => {
    const lower = 'app://chat/thread/abc';
    expect(sourcePointId(REF, 0)).not.toBe(sourcePointId(lower, 0));
    expect(sourcePointId(REF, 0)).not.toBe(pointId(REF, 0));

    const { processor, mocks } = setup();
    await processor.processSource(REF, 'chat');
    expect(mocks.getPayload).toHaveBeenCalledWith(sourcePointId(REF, 0));
  });

  it('keeps created_at from chunk 0 on replace and removes orphan chunks', async () => {
    const { processor, mocks } = setup(undefined, {
      content_hash: 'old',
      total_chunks: 3,
      created_at: 100,
    });
    await processor.processSource(REF, 'chat');

    const [point] = mocks.upsert.mock.calls[0][0] as UpsertedPoint[];
    expect(point.payload['created_at']).toBe(100);
    expect(point.payload['modified_at']).toBeGreaterThan(100);
    expect(mocks.delete).toHaveBeenCalledWith([
      sourcePointId(REF, 1),
      sourcePointId(REF, 2),
    ]);
  });

  it('skips unchanged content and metadata without writing', async () => {
    const { processor, mocks } = setup(undefined, storedPayload());
    const result = await processor.processSource(REF, 'chat');

    expect(result).toEqual({
      source: REF,
      status: 'unchanged',
      matched_rules: ['chat'],
    });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.setPayload).not.toHaveBeenCalled();
  });

  it('updates metadata with setPayload only when content is unchanged', async () => {
    const { processor, mocks } = setup(
      undefined,
      storedPayload({ user_id: 'old', total_chunks: 2 }),
    );
    const result = await processor.processSource(REF, 'chat');

    expect(result).toMatchObject({ status: 'indexed', chunks: 2 });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    const [ids, payload] = mocks.setPayload.mock.calls[0] as [
      string[],
      Record<string, unknown>,
    ];
    expect(ids).toEqual([sourcePointId(REF, 0), sourcePointId(REF, 1)]);
    expect(payload).toMatchObject({
      user_id: 'u1',
      source: REF,
      source_rule: 'chat',
    });
    expect(payload).not.toHaveProperty('file_path');
    expect(payload).not.toHaveProperty('chunk_text');
  });

  it('rewrites fully when a stored metadata key is no longer projected', async () => {
    const { processor, mocks } = setup(
      undefined,
      storedPayload({ stale: true }),
    );
    await processor.processSource(REF, 'chat');
    expect(mocks.setPayload).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });

  it('deletes the document points and enrichment on 404', async () => {
    const { processor, mocks, enrichmentStore } = setup(
      { kind: 'gone' },
      { total_chunks: 2 },
    );
    const result = await processor.processSource(REF, 'chat');

    expect(result).toEqual({ source: REF, status: 'deleted' });
    expect(mocks.delete).toHaveBeenCalledWith([
      sourcePointId(REF, 0),
      sourcePointId(REF, 1),
    ]);
    expect(enrichmentStore.delete).toHaveBeenCalledWith(REF);
    expect(mocks.clear).toHaveBeenCalledWith(REF);
  });

  it('records a callback error under the exact reference and leaves points alone', async () => {
    const { processor, mocks } = setup({
      kind: 'error',
      code: 'source_unavailable',
      message: 'HTTP 503',
    });
    const result = await processor.processSource(REF, 'chat');

    expect(result).toEqual({
      source: REF,
      status: 'failed',
      error: { code: 'source_unavailable', message: 'HTTP 503' },
    });
    expect(mocks.record).toHaveBeenCalledWith(
      REF,
      'source_unavailable',
      'HTTP 503',
      { ...OP, rule: 'chat' },
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.setPayload).not.toHaveBeenCalled();
  });

  it('returns match_failed with AJV details', async () => {
    const strict = setup({ kind: 'document', body: { a: 1 } });
    strict.processor.updateRules(
      compileRules([
        {
          name: 'chat',
          description: 'Chat',
          match: {
            type: 'object',
            properties: { json: { type: 'object', required: ['userId'] } },
          },
        },
      ]),
    );
    const result = await strict.processor.processSource(REF, 'chat');
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('match_failed');
    expect(result.error?.details).toEqual([
      expect.objectContaining({ keyword: 'required' }),
    ]);
    // The issue records the designated rule and the same AJV errors.
    const call = strict.mocks.record.mock.calls[0] as unknown[];
    expect([call[1], call[3]]).toEqual([
      'match_failed',
      { ...OP, rule: 'chat', details: result.error?.details },
    ]);
    expect(strict.mocks.upsert).not.toHaveBeenCalled();
  });

  it('returns rule_missing and leaves points untouched', async () => {
    const { processor, mocks } = setup();
    const result = await processor.processSource(REF, 'gone-rule');
    expect(result.error?.code).toBe('rule_missing');
    expect(mocks.record.mock.calls[0]?.[3]).toEqual({
      ...OP,
      rule: 'gone-rule',
    });
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
