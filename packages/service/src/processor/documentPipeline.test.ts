/**
 * @module processor/documentPipeline.test
 * indexDocument: the values index is fed by files only (sources never touch it, unchanged or not); a metadata-only refresh keeps an `upsert_error` issue like the unchanged path; empty text is `skipped`.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { contentHash } from '../hash';
import type { IssueRecord } from '../issues/types';
import type { VectorStore } from '../vectorStore';
import type { DocumentIdentity } from './documentIdentity';
import { indexDocument, type PipelineContext } from './documentPipeline';
import type { ResolvedDocument } from './resolvers/types';

const TEXT = 'hello world';

function document(
  identity: DocumentIdentity,
  metadata: Record<string, unknown> = { user_id: 'u1' },
  text = TEXT,
): ResolvedDocument {
  return {
    identity,
    text,
    splitterExt: '.txt',
    metadata,
    metadataWithRules: { ...metadata, matched_rules: ['r'] },
    matchedRules: ['r'],
    refreshMetadataWhenUnchanged: identity.kind === 'source',
    dates: () => Promise.resolve({ createdAt: 1, modifiedAt: 2 }),
  };
}

function setup(existing: Record<string, unknown> | null = null) {
  const issues: Record<string, IssueRecord[]> = {};
  const store = {
    getPayload: vi.fn().mockResolvedValue(existing),
    upsert: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    setPayload: vi.fn().mockResolvedValue(undefined),
    deletePayload: vi.fn().mockResolvedValue(undefined),
  };
  const valuesManager = { update: vi.fn() };
  const issuesManager = {
    record: vi.fn(),
    clear: vi.fn((key: string) => {
      Reflect.deleteProperty(issues, key);
    }),
    get: (key: string) => issues[key],
  };
  const ctx: PipelineContext = {
    embeddingProvider: {
      dimensions: 1,
      embed: vi.fn((texts: string[]) =>
        Promise.resolve(texts.map(() => [0.1])),
      ),
    },
    vectorStore: store as unknown as VectorStore,
    logger: pino({ level: 'silent' }),
    issuesManager,
    valuesManager,
  };
  return { ctx, store, valuesManager, issues };
}

const source: DocumentIdentity = {
  kind: 'source',
  ref: 'app://t/1',
  rule: 'r',
};
const file: DocumentIdentity = { kind: 'file', filePath: '/docs/a.md' };

describe('indexDocument values index', () => {
  it('never updates the values index for a source document', async () => {
    const { ctx, valuesManager, store } = setup();
    expect(await indexDocument(ctx, document(source))).toMatchObject({
      status: 'indexed',
    });
    expect(store.upsert).toHaveBeenCalledOnce();
    expect(valuesManager.update).not.toHaveBeenCalled();
  });

  it('still updates the values index for files (unchanged content too)', async () => {
    const { ctx, valuesManager } = setup({ content_hash: contentHash(TEXT) });
    expect(await indexDocument(ctx, document(file))).toEqual({
      status: 'unchanged',
    });
    expect(valuesManager.update).toHaveBeenCalledWith('r', { user_id: 'u1' });
  });
});

describe('indexDocument unchanged content', () => {
  const stored = {
    content_hash: contentHash(TEXT),
    total_chunks: 1,
    source: 'app://t/1',
    source_rule: 'r',
    matched_rules: ['r'],
    user_id: 'u0',
  };
  const upsertError: IssueRecord = {
    type: 'upsert_error',
    message: 'partial',
    timestamp: 0,
  };

  it('keeps an upsert_error issue on a metadata-only refresh', async () => {
    const { ctx, store, issues } = setup(stored);
    issues['app://t/1'] = [upsertError];
    expect(await indexDocument(ctx, document(source))).toEqual({
      status: 'indexed',
      chunks: 1,
    });
    expect(store.setPayload).toHaveBeenCalledOnce();
    expect(store.upsert).not.toHaveBeenCalled();
    expect(issues['app://t/1']).toEqual([upsertError]);
  });

  it('clears other issues on a metadata-only refresh', async () => {
    const { ctx, issues } = setup(stored);
    issues['app://t/1'] = [{ ...upsertError, type: 'source_unavailable' }];
    await indexDocument(ctx, document(source));
    expect(issues['app://t/1']).toBeUndefined();
  });

  it('skips empty text', async () => {
    const { ctx, store } = setup();
    expect(await indexDocument(ctx, document(source, {}, '  '))).toEqual({
      status: 'skipped',
    });
    expect(store.upsert).not.toHaveBeenCalled();
  });
});
