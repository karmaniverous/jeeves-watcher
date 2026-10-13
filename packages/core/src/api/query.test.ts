/**
 * @module api/query.test
 * Tests for the POST /search and POST /scan request/response schemas.
 */

import { describe, expect, it } from 'vitest';

import {
  scanRequestSchema,
  scanResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
} from './query';

describe('searchRequestSchema', () => {
  it('accepts a full request', () => {
    const body = {
      query: 'hello',
      limit: 5,
      offset: 10,
      filter: { must: [{ key: 'domain', match: { value: 'x' } }] },
    };
    expect(searchRequestSchema.parse(body)).toEqual(body);
  });

  it('accepts a query alone', () => {
    expect(searchRequestSchema.parse({ query: 'q' })).toEqual({ query: 'q' });
  });

  it.each([
    ['missing query', {}],
    ['empty query', { query: '' }],
    ['non-string query', { query: 3 }],
    ['zero limit', { query: 'q', limit: 0 }],
    ['fractional limit', { query: 'q', limit: 1.5 }],
    ['negative offset', { query: 'q', offset: -1 }],
    ['array filter', { query: 'q', filter: [] }],
    ['an unknown key (unsupported collapse)', { query: 'q', collapse: 'x' }],
  ])('rejects %s', (_label, body) => {
    expect(searchRequestSchema.safeParse(body).success).toBe(false);
  });

  it('validates a response', () => {
    expect(
      searchResponseSchema.safeParse([{ id: 'a', score: 0.9, payload: {} }])
        .success,
    ).toBe(true);
  });
});

describe('scanRequestSchema', () => {
  it('accepts a full request with a numeric cursor', () => {
    const body = {
      filter: {},
      limit: 1000,
      cursor: 5,
      fields: ['file_path'],
      countOnly: false,
    };
    expect(scanRequestSchema.parse(body)).toEqual(body);
  });

  it('reports the legacy message for a missing filter', () => {
    const result = scanRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Missing required field: filter (object)',
    );
  });

  it.each([0, 1001, 'ten'])('rejects limit %s with the legacy message', (l) => {
    const result = scanRequestSchema.safeParse({ filter: {}, limit: l });
    expect(result.error?.issues[0]?.message).toBe(
      'limit must be between 1 and 1000',
    );
  });

  it('rejects a non-string fields entry', () => {
    expect(
      scanRequestSchema.safeParse({ filter: {}, fields: [1] }).success,
    ).toBe(false);
  });

  it('validates page and count responses', () => {
    expect(
      scanResponseSchema.safeParse({ points: [], cursor: null }).success,
    ).toBe(true);
    expect(scanResponseSchema.safeParse({ count: 3 }).success).toBe(true);
    expect(scanResponseSchema.safeParse({ count: -1 }).success).toBe(false);
  });
});
