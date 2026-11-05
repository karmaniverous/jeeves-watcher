/**
 * @module api/catalog/countFacetsPlan.test
 * `countFacets` planning (D123, D155): mode from an agreed uiHint, else from the payload index type; 400 naming every field without a usable index; and the nested count filter.
 */

import { describe, expect, it } from 'vitest';

import { RequestError } from '../requestError';
import { agreedHint, countFilter, planFields } from './countFacetsPlan';
import type { RuleSchema } from './ruleSchemas';

const schema = (
  rule: string,
  properties: RuleSchema['properties'],
): RuleSchema => ({ rule, properties });

const indexes = {
  tag: 'keyword',
  size: 'integer',
  score: 'float',
  at: 'datetime',
  flag: 'bool',
  body: 'text',
};

describe('agreedHint', () => {
  it.each<[string, RuleSchema[], string | undefined]>([
    ['no rule declares it', [schema('a', {})], undefined],
    [
      'every declaring rule agrees',
      [
        schema('a', { f: { type: 'number', uiHint: 'range' } }),
        schema('b', {}),
        schema('c', { f: { type: 'number', uiHint: 'range' } }),
      ],
      'range',
    ],
    [
      'hints disagree',
      [
        schema('a', { f: { uiHint: 'date' } }),
        schema('b', { f: { uiHint: 'dropdown' } }),
      ],
      undefined,
    ],
    [
      'one declaring rule gives no hint',
      [schema('a', { f: { uiHint: 'date' } }), schema('b', { f: {} })],
      undefined,
    ],
    [
      'an enum without a hint',
      [schema('a', { f: { enum: ['x'] } })],
      'dropdown',
    ],
  ])('%s', (_name, rules, expected) => {
    expect(agreedHint('f', rules)).toBe(expected);
  });
});

describe('planFields', () => {
  it('lets the index type decide without hints: keyword, integer, bool count; float, datetime range', () => {
    expect(
      planFields(['tag', 'size', 'flag', 'score', 'at'], [], indexes),
    ).toEqual([
      { field: 'tag', mode: 'counts' },
      { field: 'size', mode: 'counts' },
      { field: 'flag', mode: 'counts' },
      { field: 'score', mode: 'range' },
      { field: 'at', mode: 'range' },
    ]);
  });

  it('lets an agreed hint decide: number, date and range are ranges, others counts', () => {
    const rules = [
      schema('a', {
        size: { uiHint: 'number' },
        at: { uiHint: 'date' },
        score: { uiHint: 'range' },
        tag: { uiHint: 'tags' },
      }),
    ];
    expect(planFields(['size', 'at', 'score', 'tag'], rules, indexes)).toEqual([
      { field: 'size', mode: 'range' },
      { field: 'at', mode: 'range' },
      { field: 'score', mode: 'range' },
      { field: 'tag', mode: 'counts' },
    ]);
  });

  it('plans a repeated field once', () => {
    expect(planFields(['tag', 'tag'], [], indexes)).toEqual([
      { field: 'tag', mode: 'counts' },
    ]);
  });

  it('answers 400 naming every field without a usable index', () => {
    const rules = [
      schema('a', { tag: { uiHint: 'date' }, at: { uiHint: 'dropdown' } }),
    ];
    let error: unknown;
    try {
      planFields(['size', 'missing', 'body', 'tag', 'at'], rules, indexes);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(RequestError);
    const { status, message, extras } = error as RequestError;
    expect(status).toBe(400);
    expect(message).toBe(
      'No usable payload index for fields: missing, body, tag, at',
    );
    expect(extras.message).toContain('vectorStore.payloadIndexes');
    expect(extras.details).toEqual({
      fields: {
        missing: { mode: 'counts', index: null },
        body: { mode: 'counts', index: 'text' },
        tag: { mode: 'range', index: 'keyword' },
        at: { mode: 'counts', index: 'datetime' },
      },
    });
  });

  it('names a single field in the singular', () => {
    expect(() => planFields(['missing'], [], indexes)).toThrow(
      'No usable payload index for field: missing',
    );
  });
});

describe('countFilter', () => {
  it('keeps chunk 0 only without a filter or rules', () => {
    expect(countFilter()).toEqual({
      must: [{ key: 'chunk_index', match: { value: 0 } }],
    });
  });

  it("nests the caller's filter (a top-level should keeps its meaning) and the rule scope", () => {
    const filter = {
      should: [
        { key: 'a', match: { value: 1 } },
        { key: 'b', match: { value: 2 } },
      ],
    };
    expect(countFilter(filter, ['r1', 'r2'])).toEqual({
      must: [
        filter,
        {
          should: [
            { key: 'matched_rules', match: { any: ['r1', 'r2'] } },
            { key: 'source_rule', match: { any: ['r1', 'r2'] } },
          ],
        },
        { key: 'chunk_index', match: { value: 0 } },
      ],
    });
  });
});
