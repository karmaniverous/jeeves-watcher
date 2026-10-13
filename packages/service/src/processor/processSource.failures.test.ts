/**
 * @module processor/processSource.failures.test
 * Source failures that must not index: a failed 404 delete is an `upsert_error` (points and enrichment kept); a document that renders no text is a `no_content` failure (not `unchanged`), and a designated rule whose schema `set` or template fails is an `interpolation_error` with the rule errors as details; `match_failed` (AJV details) and `rule_missing` (nothing retrieved) are recorded with the designated rule; no points are written either way. A failed chunk-0 read is a failure, never "not indexed" (no re-embed, `created_at` kept).
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { compileRules } from '../rules';
import { doc, RULE, sourceReindexFixture } from '../test/sourceReindexFixture';
import type { VectorStore } from '../vectorStore';
import type { PipelineContext } from './documentPipeline';
import {
  processSourceDocument,
  type SourceProcessingDeps,
} from './processSource';
import type { SourceResolver } from './resolvers/SourceResolver';
import type { ResolvedDocument } from './resolvers/types';

const REF = 'app://chat/thread/x';
const OPERATION = 'Failed to process source document';

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

/** Pipeline over the fixture's store and issues. */
function pipelineOf(
  f: ReturnType<typeof sourceReindexFixture>,
): PipelineContext {
  return {
    embeddingProvider: { dimensions: 1, embed: f.embed },
    vectorStore: f.store as unknown as VectorStore,
    logger: pino({ level: 'silent' }),
    issuesManager: f.issues,
  };
}

/** A resolver that always answers `outcome`. */
const resolverOf = (outcome: unknown) =>
  ({ resolve: () => Promise.resolve(outcome) }) as unknown as SourceResolver;

describe('processSource failures', () => {
  it('records upsert_error and keeps points and enrichment when the 404 delete fails', async () => {
    const f = sourceReindexFixture({ [REF]: doc('u1', 'hello') });
    await f.index(REF);
    f.store.delete.mockRejectedValueOnce(new Error('qdrant down'));
    const enrichmentStore = { delete: vi.fn() };

    const result = await processSourceDocument(
      {
        pipeline: pipelineOf(f),
        resolver: resolverOf({ kind: 'gone' }),
        enrichmentStore:
          enrichmentStore as unknown as SourceProcessingDeps['enrichmentStore'],
      },
      REF,
      RULE,
    );

    expect(result).toEqual({
      source: REF,
      status: 'failed',
      error: { code: 'upsert_error', message: 'qdrant down' },
    });
    expect(enrichmentStore.delete).not.toHaveBeenCalled();
    expect(f.store.points.size).toBe(1);
    expect(f.issues.get(REF)).toEqual([
      expect.objectContaining({ type: 'upsert_error', rule: RULE }),
    ]);
  });

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
    const result = await processSourceDocument(
      {
        pipeline: pipelineOf(f),
        resolver: resolverOf({ kind: 'document', document }),
      },
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

  it('returns match_failed with AJV details and records them with the rule', async () => {
    const f = sourceReindexFixture({
      [REF]: { kind: 'document', body: { a: 1 } },
    });
    f.processor.updateRules(
      compileRules([
        {
          name: RULE,
          description: 'Chat',
          match: {
            type: 'object',
            properties: { json: { type: 'object', required: ['userId'] } },
          },
        },
      ]),
    );

    const result = await f.processor.sourceOperations().process(REF, RULE);

    expect(result.error?.code).toBe('match_failed');
    expect(result.error?.details).toEqual([
      expect.objectContaining({ keyword: 'required' }),
    ]);
    expect(f.issues.get(REF)).toEqual([
      expect.objectContaining({
        type: 'match_failed',
        operation: OPERATION,
        rule: RULE,
        details: result.error?.details,
      }),
    ]);
    expect(f.store.upsert).not.toHaveBeenCalled();
  });

  it('returns rule_missing without retrieving or touching points', async () => {
    const f = sourceReindexFixture({ [REF]: doc('u1', 'hello') });

    const result = await f.processor.sourceOperations().process(REF, 'gone');

    expect(result.error?.code).toBe('rule_missing');
    expect(f.issues.get(REF)).toEqual([
      expect.objectContaining({ type: 'rule_missing', rule: 'gone' }),
    ]);
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(f.store.delete).not.toHaveBeenCalled();
    expect(f.store.upsert).not.toHaveBeenCalled();
  });
});
