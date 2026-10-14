/**
 * @module filters.test
 * Unit tests for the Qdrant filter helpers: leaf conditions and the and/or/not merge rules.
 */

import { describe, expect, it } from 'vitest';

import { f } from './filters';

const A = { key: 'a', match: { value: 1 } };
const B = { key: 'b', match: { value: 'x' } };
const C = { key: 'c', match: { value: true } };

describe('f leaf helpers', () => {
  it('eq, any, range and isEmpty build single-condition filters', () => {
    expect(f.eq('a', 1)).toEqual({ must: [A] });
    expect(f.any('t', ['x', 'y'])).toEqual({
      must: [{ key: 't', match: { any: ['x', 'y'] } }],
    });
    expect(f.range('ts', { gte: 1, lt: 5 })).toEqual({
      must: [{ key: 'ts', range: { gte: 1, lt: 5 } }],
    });
    expect(f.range('at', { gt: '2026-01-01T00:00:00Z' })).toEqual({
      must: [{ key: 'at', range: { gt: '2026-01-01T00:00:00Z' } }],
    });
    expect(f.isEmpty('tags')).toEqual({
      must: [{ is_empty: { key: 'tags' } }],
    });
  });
});

describe('f.and', () => {
  it('concatenates must conditions', () => {
    expect(f.and(f.eq('a', 1), f.eq('b', 'x'))).toEqual({ must: [A, B] });
  });

  it('merges must_not lists and hoists one should group', () => {
    expect(
      f.and(
        f.eq('a', 1),
        f.not(f.eq('b', 'x')),
        f.or(f.eq('c', true), f.eq('a', 1)),
      ),
    ).toEqual({ must: [A], should: [C, A], must_not: [B] });
  });

  it('nests a second should group and mixed filters', () => {
    const or1 = f.or(f.eq('a', 1), f.eq('b', 'x'));
    const or2 = f.or(f.eq('c', true), f.eq('a', 1));
    const mixed = { must: [A], must_not: [B] };
    expect(f.and(or1, or2, mixed)).toEqual({
      must: [or2, mixed],
      should: [A, B],
    });
  });

  it('flattens nested ands', () => {
    expect(f.and(f.and(f.eq('a', 1), f.eq('b', 'x')), f.eq('c', true))).toEqual(
      { must: [A, B, C] },
    );
  });

  it('of nothing is the match-all filter', () => {
    expect(f.and()).toEqual({});
  });
});

describe('f.or', () => {
  it('unwraps single conditions and merges should lists', () => {
    expect(f.or(f.eq('a', 1), f.or(f.eq('b', 'x'), f.eq('c', true)))).toEqual({
      should: [A, B, C],
    });
  });

  it('nests multi-condition operands', () => {
    const both = f.and(f.eq('a', 1), f.eq('b', 'x'));
    expect(f.or(both, f.eq('c', true))).toEqual({ should: [both, C] });
  });
});

describe('f.not', () => {
  it('negates a single condition as must_not', () => {
    expect(f.not(f.eq('a', 1))).toEqual({ must_not: [A] });
  });

  it('turns not(or) into must_not of all operands', () => {
    expect(f.not(f.or(f.eq('a', 1), f.eq('b', 'x')))).toEqual({
      must_not: [A, B],
    });
  });

  it('double negation restores the condition', () => {
    expect(f.not(f.not(f.eq('a', 1)))).toEqual({ must: [A] });
  });

  it('not(none of xs) is any of xs', () => {
    expect(f.not({ must_not: [A, B] })).toEqual({ should: [A, B] });
  });

  it('nests a multi-condition and', () => {
    const both = f.and(f.eq('a', 1), f.eq('b', 'x'));
    expect(f.not(both)).toEqual({ must_not: [both] });
  });
});
