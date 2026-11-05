/**
 * @module api/catalog/facetRules.test
 * The `rules` scoping shared by the facet routes: parsing the comma-separated query value and rejecting unknown rule names with `400 invalid_request`.
 */

import { describe, expect, it } from 'vitest';

import { RequestError } from '../requestError';
import { EMPTY_RULES, parseRuleList, requireKnownRules } from './facetRules';

/** Run `fn` and return the RequestError it throws. */
function thrown(fn: () => unknown): RequestError {
  try {
    fn();
  } catch (err) {
    if (err instanceof RequestError) return err;
    throw err;
  }
  throw new Error('expected a RequestError');
}

describe('parseRuleList', () => {
  it('splits, trims and drops duplicates in first-seen order', () => {
    expect(parseRuleList(' b, a ,b,,c ')).toEqual(['b', 'a', 'c']);
  });

  it.each(['', ' ', ',', ' , ,'])('rejects %j as naming no rule', (value) => {
    const err = thrown(() => parseRuleList(value));
    expect(err.status).toBe(400);
    expect(err.code).toBe('invalid_request');
    expect(err.message).toBe(EMPTY_RULES);
  });
});

describe('requireKnownRules', () => {
  const held = new Set(['a', 'b', 'virtual-x']);

  it('returns the distinct names when every one is held', () => {
    expect(requireKnownRules(['virtual-x', 'a', 'a'], held)).toEqual([
      'virtual-x',
      'a',
    ]);
  });

  it('names one unknown rule', () => {
    const err = thrown(() => requireKnownRules(['a', 'nope'], held));
    expect(err.status).toBe(400);
    expect(err.message).toBe('Unknown rule: nope');
    expect(err.extras).toEqual({ details: { unknownRules: ['nope'] } });
  });

  it('names every unknown rule once', () => {
    const err = thrown(() => requireKnownRules(['x', 'y', 'x'], held));
    expect(err.message).toBe('Unknown rules: x, y');
  });
});
