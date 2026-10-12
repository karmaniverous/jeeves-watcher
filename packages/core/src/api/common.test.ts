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
  qdrantFilterSchema,
  requireExactlyOneTarget,
} from './common';

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
});
