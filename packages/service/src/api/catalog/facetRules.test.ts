/**
 * @module api/catalog/facetRules.test
 * The `rules` scoping shared by the facet routes: parsing the comma-separated query value (`EmptyRuleList` when it names none) and rejecting unknown rule names (`UnknownRules`), both `400 WATCHER_INVALID_REQUEST`.
 */

import { describe, expect, it } from 'vitest';

import { EmptyRuleList, MESSAGE_ARG_MAX, UnknownRules } from '../errors';
import { parseRuleList, requireKnownRules } from './facetRules';

/** Run `fn` and return what it throws. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

describe('parseRuleList', () => {
  it('splits, trims and drops duplicates in first-seen order', () => {
    expect(parseRuleList(' b, a ,b,,c ')).toEqual(['b', 'a', 'c']);
  });

  it.each(['', ' ', ',', ' , ,'])('rejects %j as naming no rule', (value) => {
    const err = thrown(() => parseRuleList(value));
    expect(err).toBeInstanceOf(EmptyRuleList);
    expect(err).toMatchObject({
      statusCode: 400,
      code: 'WATCHER_INVALID_REQUEST',
      message: 'rules must name at least one rule',
    });
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
    expect(err).toBeInstanceOf(UnknownRules);
    expect(err).toMatchObject({
      statusCode: 400,
      code: 'WATCHER_INVALID_REQUEST',
      message: 'Unknown rule(s): nope',
    });
  });

  it('names every unknown rule once', () => {
    const err = thrown(() => requireKnownRules(['x', 'y', 'x'], held));
    expect(err).toMatchObject({ message: 'Unknown rule(s): x, y' });
  });

  it('caps a long list of unknown rules', () => {
    const names = Array.from({ length: 100 }, (_, i) => `rule-${String(i)}`);
    const err = thrown(() => requireKnownRules(names, held));
    expect(err).toMatchObject({
      message: `Unknown rule(s): ${names.join(', ').slice(0, MESSAGE_ARG_MAX - 1)}…`,
    });
  });
});
