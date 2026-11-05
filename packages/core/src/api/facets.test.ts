import { describe, expect, it } from 'vitest';

import {
  countFacetsRequestSchema,
  countFacetsResponseSchema,
  listFacetsQuerySchema,
} from './facets.js';

const fields = (n: number) =>
  Array.from({ length: n }, (_, i) => `f${String(i)}`);

describe('countFacetsRequestSchema', () => {
  it.each([
    ['one field', { fields: ['a'] }],
    ['twenty fields', { fields: fields(20) }],
    [
      'filter, rules and limit',
      {
        filter: { must: [{ key: 't', match: { value: 'x' } }] },
        rules: ['a', 'b'],
        fields: ['a'],
        limit: 1000,
      },
    ],
  ])('accepts %s', (_name, body) => {
    expect(countFacetsRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['no fields', {}, 'fields must name 1 to 20 fields'],
    ['empty fields', { fields: [] }, 'fields must name 1 to 20 fields'],
    ['21 fields', { fields: fields(21) }, 'fields must name 1 to 20 fields'],
    ['an empty field name', { fields: [''] }, 'field names must be non-empty'],
    [
      'limit 0',
      { fields: ['a'], limit: 0 },
      'limit must be between 1 and 1000',
    ],
    [
      'limit 1001',
      { fields: ['a'], limit: 1001 },
      'limit must be between 1 and 1000',
    ],
    [
      'a fractional limit',
      { fields: ['a'], limit: 1.5 },
      'limit must be an integer',
    ],
    [
      'empty rules',
      { fields: ['a'], rules: [] },
      'rules must name at least one rule',
    ],
    [
      'an empty rule name',
      { fields: ['a'], rules: [''] },
      'rule names must be non-empty',
    ],
  ])('rejects %s', (_name, body, message) => {
    const result = countFacetsRequestSchema.safeParse(body);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it('rejects an unknown key instead of ignoring it', () => {
    expect(
      countFacetsRequestSchema.safeParse({ fields: ['a'], field: 'b' }).success,
    ).toBe(false);
  });
});

describe('countFacetsResponseSchema', () => {
  it('takes value counts and ranges side by side', () => {
    const body = {
      counts: {
        tag: [
          { value: 'x', count: 2 },
          { value: 3, count: 1 },
          { value: true, count: 1 },
        ],
        size: { min: 1, max: 9 },
        at: { min: '2026-01-01T00:00:00Z', max: null },
      },
    };
    expect(countFacetsResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a negative count', () => {
    expect(
      countFacetsResponseSchema.safeParse({
        counts: { tag: [{ value: 'x', count: -1 }] },
      }).success,
    ).toBe(false);
  });
});

describe('listFacetsQuerySchema', () => {
  it('keeps rules and strips unknown keys (0.20.0 ignored the query)', () => {
    expect(listFacetsQuerySchema.parse({ rules: 'a,b', x: '1' })).toEqual({
      rules: 'a,b',
    });
    expect(listFacetsQuerySchema.parse({})).toEqual({});
  });
});
