/**
 * @module api/documents.test
 * Tests for the POST /documents and POST /documents/delete schemas.
 */

import { describe, expect, it } from 'vitest';

import {
  documentRejectionCodeSchema,
  documentsAcceptedResponseSchema,
  documentsDeleteRequestSchema,
  documentsDeleteResponseSchema,
  documentsEnvelopeSchema,
  documentsQuerySchema,
  documentsRequestSchema,
  documentsResultsResponseSchema,
  MAX_DELETE_SOURCES_PER_REQUEST,
  MAX_DOCUMENTS_PER_REQUEST,
} from './documents';

const doc = { source: 'app://chat/thread/1', rule: 'app-thread' };

describe('documentsRequestSchema', () => {
  it('accepts 1 and 100 documents', () => {
    expect(documentsRequestSchema.parse({ documents: [doc] })).toEqual({
      documents: [doc],
    });
    const max = Array.from({ length: MAX_DOCUMENTS_PER_REQUEST }, () => doc);
    expect(documentsRequestSchema.safeParse({ documents: max }).success).toBe(
      true,
    );
  });

  it.each([
    ['no documents key', {}],
    ['zero documents', { documents: [] }],
    ['101 documents', { documents: Array.from({ length: 101 }, () => doc) }],
    ['a malformed reference', { documents: [{ ...doc, source: 'app:1' }] }],
    ['a missing rule', { documents: [{ source: doc.source }] }],
    ['an empty rule', { documents: [{ ...doc, rule: '' }] }],
    ['inline push content', { documents: [{ ...doc, text: 'hi' }] }],
    [
      'inline push properties',
      { documents: [{ ...doc, properties: { user_id: 'u1' } }] },
    ],
  ])('rejects %s', (_label, body) => {
    expect(documentsRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('documentsEnvelopeSchema', () => {
  it('accepts a malformed reference (validated per document)', () => {
    const body = { documents: [{ ...doc, source: 'app:1' }] };
    expect(documentsEnvelopeSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['zero documents', { documents: [] }],
    ['101 documents', { documents: Array.from({ length: 101 }, () => doc) }],
    ['an empty source', { documents: [{ ...doc, source: '' }] }],
    ['a non-string source', { documents: [{ ...doc, source: 1 }] }],
    ['a missing rule', { documents: [{ source: doc.source }] }],
    ['inline push content', { documents: [{ ...doc, text: 'hi' }] }],
    [
      'inline push properties',
      { documents: [{ ...doc, properties: { user_id: 'u1' } }] },
    ],
  ])('rejects %s', (_label, body) => {
    expect(documentsEnvelopeSchema.safeParse(body).success).toBe(false);
  });

  it('lists the rejection codes', () => {
    expect(documentRejectionCodeSchema.options).toEqual([
      'invalid_reference',
      'unknown_source',
      'invalid_id',
      'rule_missing',
      'queue_stopped',
    ]);
  });
});

describe('documentsQuerySchema', () => {
  it.each([
    [{}, undefined],
    [{ wait: 'true' }, true],
    [{ wait: '1' }, true],
    [{ wait: 'false' }, false],
    [{ wait: true }, true],
  ])('parses %j', (query, expected) => {
    expect(documentsQuerySchema.parse(query).wait).toBe(expected);
  });

  it('rejects an unrecognised wait value', () => {
    expect(documentsQuerySchema.safeParse({ wait: 'maybe' }).success).toBe(
      false,
    );
  });
});

describe('documents responses', () => {
  it('validates a 202 body', () => {
    expect(
      documentsAcceptedResponseSchema.safeParse({
        accepted: [doc.source],
        rejected: [
          {
            source: 'zz://1',
            error: { code: 'unknown_source', message: 'not configured' },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('validates a ?wait=true body', () => {
    expect(
      documentsResultsResponseSchema.safeParse({
        results: [
          {
            source: doc.source,
            status: 'indexed',
            chunks: 2,
            matched_rules: [],
          },
          {
            source: 'app://2',
            status: 'failed',
            error: { code: 'match_failed', message: 'x', details: [{}] },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts a rejection code as a ?wait=true failure code', () => {
    expect(
      documentsResultsResponseSchema.safeParse({
        results: [
          {
            source: 'app:bad',
            status: 'failed',
            error: { code: 'invalid_reference', message: 'x' },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    [
      'an untyped result error code',
      {
        results: [
          {
            source: doc.source,
            status: 'failed',
            error: { code: 'boom', message: 'x' },
          },
        ],
      },
      documentsResultsResponseSchema,
    ],
    [
      'a non-rejection code in a 202 rejection',
      {
        accepted: [],
        rejected: [
          { source: 'zz://1', error: { code: 'match_failed', message: 'x' } },
        ],
      },
      documentsAcceptedResponseSchema,
    ],
  ])('rejects %s', (_label, body, schema) => {
    expect(schema.safeParse(body).success).toBe(false);
  });

  it('rejects an unknown result status', () => {
    expect(
      documentsResultsResponseSchema.safeParse({
        results: [{ source: doc.source, status: 'queued' }],
      }).success,
    ).toBe(false);
  });
});

describe('documentsDeleteRequestSchema', () => {
  it.each([
    ['sources', { sources: [doc.source] }],
    [
      'a filter',
      { filter: { must: [{ key: 'user_id', match: { value: 'u1' } }] } },
    ],
    [
      'a must_not-only filter',
      { filter: { must_not: [{ is_empty: { key: 'user_id' } }] } },
    ],
    [
      'a nested filter with a condition',
      { filter: { must: [{ should: [{ has_id: ['x'] }] }] } },
    ],
    [
      'a min_should filter',
      {
        filter: {
          min_should: {
            conditions: [{ key: 'a', match: { value: 1 } }],
            min_count: 1,
          },
        },
      },
    ],
  ])('accepts %s', (_label, body) => {
    expect(documentsDeleteRequestSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['an empty body', {}],
    ['both forms', { sources: [doc.source], filter: {} }],
    ['empty sources', { sources: [] }],
    ['a malformed reference', { sources: ['bad'] }],
    ['a non-object filter', { filter: 'x' }],
    ['an empty filter', { filter: {} }],
    ['an empty must', { filter: { must: [] } }],
    ['all clauses empty', { filter: { must: [], should: [], must_not: [] } }],
    ['only empty nested filters', { filter: { must: [{}, { should: [] }] } }],
    ['an empty min_should', { filter: { min_should: { conditions: [] } } }],
    ['only unknown keys', { filter: { foo: [{ key: 'a' }] } }],
  ])('rejects %s', (_label, body) => {
    expect(documentsDeleteRequestSchema.safeParse(body).success).toBe(false);
  });

  it('caps sources at MAX_DELETE_SOURCES_PER_REQUEST', () => {
    const refs = (n: number) =>
      Array.from({ length: n }, (_, i) => `app://d/${String(i)}`);
    expect(
      documentsDeleteRequestSchema.safeParse({
        sources: refs(MAX_DELETE_SOURCES_PER_REQUEST),
      }).success,
    ).toBe(true);
    const over = documentsDeleteRequestSchema.safeParse({
      sources: refs(MAX_DELETE_SOURCES_PER_REQUEST + 1),
    });
    expect(over.success).toBe(false);
    expect(JSON.stringify(over.error?.issues)).toContain(
      `at most ${String(MAX_DELETE_SOURCES_PER_REQUEST)} references`,
    );
  });

  it('validates the response', () => {
    expect(
      documentsDeleteResponseSchema.safeParse({ deleted: 3 }).success,
    ).toBe(true);
    expect(
      documentsDeleteResponseSchema.safeParse({ deleted: -1 }).success,
    ).toBe(false);
  });
});
