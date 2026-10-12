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
  MAX_DOCUMENTS_PER_REQUEST,
} from './documents';

const doc = { source: 'cg://chat/thread/1', rule: 'cg-thread' };

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
    ['a malformed reference', { documents: [{ ...doc, source: 'cg:1' }] }],
    ['a missing rule', { documents: [{ source: doc.source }] }],
    ['an empty rule', { documents: [{ ...doc, rule: '' }] }],
    ['inline push content', { documents: [{ ...doc, text: 'hi' }] }],
  ])('rejects %s', (_label, body) => {
    expect(documentsRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('documentsEnvelopeSchema', () => {
  it('accepts a malformed reference (validated per document)', () => {
    const body = { documents: [{ ...doc, source: 'cg:1' }] };
    expect(documentsEnvelopeSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['zero documents', { documents: [] }],
    ['101 documents', { documents: Array.from({ length: 101 }, () => doc) }],
    ['an empty source', { documents: [{ ...doc, source: '' }] }],
    ['a non-string source', { documents: [{ ...doc, source: 1 }] }],
    ['a missing rule', { documents: [{ source: doc.source }] }],
    ['inline push content', { documents: [{ ...doc, text: 'hi' }] }],
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
            source: 'cg://2',
            status: 'failed',
            error: { code: 'match_failed', message: 'x', details: [{}] },
          },
        ],
      }).success,
    ).toBe(true);
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
    ['a filter', { filter: { must: [] } }],
  ])('accepts %s', (_label, body) => {
    expect(documentsDeleteRequestSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['an empty body', {}],
    ['both forms', { sources: [doc.source], filter: {} }],
    ['empty sources', { sources: [] }],
    ['a malformed reference', { sources: ['bad'] }],
    ['a non-object filter', { filter: 'x' }],
  ])('rejects %s', (_label, body) => {
    expect(documentsDeleteRequestSchema.safeParse(body).success).toBe(false);
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
