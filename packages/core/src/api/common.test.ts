/**
 * @module api/common.test
 * Tests for shared API schema building blocks.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  apiErrorResponseSchema,
  documentErrorSchema,
  documentTargetShape,
  hasFilterCondition,
  nonEmptyQdrantFilterSchema,
  qdrantFilterSchema,
  requireExactlyOneTarget,
} from './common';
import { apiErrorBodySchema } from './errors';

const target = z
  .object(documentTargetShape)
  .superRefine(requireExactlyOneTarget);

describe('requireExactlyOneTarget', () => {
  it.each([[{ path: 'a.md' }], [{ source: 'app://1' }]])('accepts %j', (v) => {
    expect(target.safeParse(v).success).toBe(true);
  });

  it('reports a missing target on path', () => {
    const result = target.safeParse({});
    expect(result.error?.issues[0]?.path).toEqual(['path']);
  });

  it('reports both targets at the root', () => {
    const result = target.safeParse({ path: 'a', source: 'app://1' });
    expect(result.error?.issues[0]?.path).toEqual([]);
  });
});

describe('shared schemas', () => {
  it('accepts objects and rejects arrays as filters', () => {
    expect(qdrantFilterSchema.safeParse({ must: [] }).success).toBe(true);
    expect(qdrantFilterSchema.safeParse([]).success).toBe(false);
  });

  it('validates error bodies', () => {
    expect(
      apiErrorResponseSchema.safeParse({ error: 'x', details: [] }).success,
    ).toBe(true);
    expect(apiErrorResponseSchema.safeParse({}).success).toBe(false);
    expect(
      documentErrorSchema.safeParse({ code: 'c', message: 'm' }).success,
    ).toBe(true);
    expect(documentErrorSchema.safeParse({ code: 'c' }).success).toBe(false);
  });

  it('apiErrorBodySchema extends apiErrorResponseSchema with code', () => {
    expect(Object.keys(apiErrorBodySchema.shape).sort()).toEqual(
      [
        ...Object.keys(apiErrorResponseSchema.shape),
        'code',
        'issueType',
      ].sort(),
    );
  });
});

describe('hasFilterCondition', () => {
  it.each([
    [{}],
    [{ must: [] }],
    [{ must: [], should: [], must_not: [] }],
    [{ must: [{}] }],
    [{ should: [{ must: [] }, {}] }],
    [{ min_should: { conditions: [], min_count: 1 } }],
    [{ unknown: [{ key: 'a' }] }],
  ])('%j is condition-free', (filter) => {
    expect(hasFilterCondition(filter)).toBe(false);
    expect(nonEmptyQdrantFilterSchema.safeParse(filter).success).toBe(false);
  });

  it.each([
    [{ must: [{ key: 'a', match: { value: 1 } }] }],
    [{ must_not: [{ is_empty: { key: 'a' } }] }],
    [{ should: [{ must: [{ has_id: [1] }] }] }],
    [{ must: { key: 'a', match: { value: 1 } } }],
    [{ min_should: { conditions: [{ key: 'a', match: { value: 1 } }] } }],
  ])('%j has a condition', (filter) => {
    expect(hasFilterCondition(filter)).toBe(true);
    expect(nonEmptyQdrantFilterSchema.safeParse(filter).success).toBe(true);
  });
});
