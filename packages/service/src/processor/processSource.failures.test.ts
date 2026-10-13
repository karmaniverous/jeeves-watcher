/**
 * @module processor/processSource.failures.test
 * Source failures that must not index: a document that renders no text is a `no_content` failure (not `unchanged`), and a designated rule whose schema `set` or template fails is an `interpolation_error` with the rule errors as details; no points are written either way. A failed chunk-0 read is a failure, never "not indexed" (no re-embed, `created_at` kept).
 */

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { compileRules } from '../rules';
import { doc, RULE, sourceReindexFixture } from '../test/sourceReindexFixture';
import type { VectorStore } from '../vectorStore';
import type { PipelineContext } from './documentPipeline';
import { processSourceDocument } from './processSource';
import type { SourceResolver } from './resolvers/SourceResolver';
import type { ResolvedDocument } from './resolvers/types';

const REF = 'app://chat/thread/x';

/** A designated rule whose schema `set` throws (unknown helper). */
function brokenSetRules() {
  return compileRules([
    {
      name: RULE,
      description: 'Chat',
      match: { type: 'object', required: ['source', 'json'] },
      schema: [
        {
          type: 'object',
          properties: {
            user_id: { type: 'string', set: '{{noSuchHelper json.userId}}' },
          },
        },
      ],
    },
  ]);
}

describe('processSource failures', () => {
  it('fails with no_content when the document has no text to embed', async () => {
    const f = sourceReindexFixture({});
    const document: ResolvedDocument = {
      identity: { kind: 'source', ref: REF, rule: RULE },
      text: '   ',
      splitterExt: '.txt',
      metadata: {},
      metadataWithRules: { matched_rules: [RULE] },
      matchedRules: [RULE],
      renderAs: 'json',
      transformed: false,
      onUnchanged: 'refresh',
      logLabel: 'Source document',
      dates: () => Promise.resolve({ createdAt: 1, modifiedAt: 1 }),
    };
    const resolver = {
      resolve: () => Promise.resolve({ kind: 'document', document }),
    } as unknown as SourceResolver;
    const pipeline: PipelineContext = {
      embeddingProvider: { dimensions: 1, embed: f.embed },
      vectorStore: f.store as unknown as VectorStore,
      logger: pino({ level: 'silent' }),
      issuesManager: f.issues,
    };

    const result = await processSourceDocument(
      { pipeline, resolver },
      REF,
      RULE,
    );

    expect(result).toMatchObject({
      source: REF,
      status: 'failed',
      error: { code: 'no_content' },
    });
    expect(f.store.upsert).not.toHaveBeenCalled();
    expect(f.issues.get(REF)).toEqual([
      expect.objectContaining({ type: 'no_content', rule: RULE }),
    ]);
  });

  it('fails (no re-embed) when the chunk-0 read fails on an indexed document', async () => {
    const f = sourceReindexFixture({ [REF]: doc('u1', 'hello') });
    await f.index(REF);
    f.retrieve.mockImplementation(() => Promise.resolve(doc('u1', 'changed')));
    f.store.getPayload.mockRejectedValueOnce(new Error('qdrant down'));
    f.store.upsert.mockClear();

    const result = await f.processor.sourceOperations().process(REF, RULE);

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'extraction_error', message: 'qdrant down' },
    });
    expect(f.embed).not.toHaveBeenCalled();
    expect(f.store.upsert).not.toHaveBeenCalled();
    expect(f.issues.get(REF)).toEqual([
      expect.objectContaining({ type: 'extraction_error', rule: RULE }),
    ]);
  });

  it('fails with interpolation_error when the rule schema set fails', async () => {
    const f = sourceReindexFixture({ [REF]: doc('u1', 'hello') });
    f.processor.updateRules(brokenSetRules());

    const result = await f.processor.sourceOperations().process(REF, RULE);

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'interpolation_error',
        details: [expect.objectContaining({ rule: RULE, stage: 'schema' })],
      },
    });
    expect(f.store.upsert).not.toHaveBeenCalled();
    expect(f.embed).not.toHaveBeenCalled();
    expect(f.issues.get(REF)).toEqual([
      expect.objectContaining({
        type: 'interpolation_error',
        rule: RULE,
        details: [expect.objectContaining({ stage: 'schema' })],
      }),
    ]);
  });
});
