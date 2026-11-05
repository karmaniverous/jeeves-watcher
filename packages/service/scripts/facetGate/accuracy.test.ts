/**
 * @module scripts/facetGate/accuracy.test
 * Approximate-count accuracy (D194): error maxima over the top values, missing top values, differing share, one-sided values, cutoff, and the 5% bound.
 */

import { describe, expect, it } from 'vitest';

import { compareCounts, withinBound } from './accuracy';

describe('compareCounts', () => {
  it('reports no error when the counts agree', () => {
    const hits = [
      { value: 'a', count: 10 },
      { value: 'b', count: 5 },
    ];
    expect(compareCounts('f', hits, [...hits].reverse())).toEqual({
      field: 'f',
      exactValues: 2,
      approxValues: 2,
      topMaxAbsError: 0,
      topMaxRelError: 0,
      topMissing: [],
      differingShare: 0,
      exactOnly: [],
      approxOnly: [],
      exactCutoff: 5,
    });
  });

  it('takes the error maxima over the top values by exact count only', () => {
    const exact = [
      { value: 'small', count: 2 },
      { value: 'big', count: 100 },
      { value: 'mid', count: 50 },
    ];
    const approx = [
      { value: 'big', count: 103 },
      { value: 'mid', count: 49 },
      { value: 'small', count: 9 },
    ];
    const result = compareCounts('f', exact, approx, 2);
    expect(result.topMaxAbsError).toBe(3);
    expect(result.topMaxRelError).toBeCloseTo(0.03);
    expect(result.differingShare).toBe(1);
    expect(result.exactCutoff).toBe(2);
  });

  it('lists top values missing from the approximate result and one-sided values', () => {
    const exact = [
      { value: 'a', count: 10 },
      { value: 'b', count: 8 },
      { value: 'c', count: 1 },
    ];
    const approx = [
      { value: 'a', count: 10 },
      { value: 'c', count: 2 },
      { value: 'd', count: 1 },
    ];
    const result = compareCounts('f', exact, approx, 2);
    expect(result.topMissing).toEqual(['b']);
    expect(result.exactOnly).toEqual(['b']);
    expect(result.approxOnly).toEqual(['d']);
    expect(result.differingShare).toBe(0.5);
    expect(result.topMaxRelError).toBe(0);
  });

  it('keeps values of different types apart', () => {
    const result = compareCounts(
      'f',
      [{ value: 1, count: 4 }],
      [{ value: '1', count: 4 }],
    );
    expect(result.topMissing).toEqual(['1']);
    expect(result.approxOnly).toEqual(['1']);
  });

  it('handles empty results', () => {
    const result = compareCounts('f', [], []);
    expect(result.exactCutoff).toBeNull();
    expect(result.differingShare).toBe(0);
  });

  it('skips the relative error of a zero exact count', () => {
    const result = compareCounts(
      'f',
      [{ value: 'z', count: 0 }],
      [{ value: 'z', count: 3 }],
    );
    expect(result.topMaxAbsError).toBe(3);
    expect(result.topMaxRelError).toBe(0);
  });
});

describe('withinBound', () => {
  const base = compareCounts(
    'f',
    [{ value: 'a', count: 100 }],
    [{ value: 'a', count: 100 }],
  );

  it('accepts errors up to the bound', () => {
    expect(withinBound([{ ...base, topMaxRelError: 0.05 }])).toBe(true);
  });

  it('rejects a larger relative error', () => {
    expect(withinBound([{ ...base, topMaxRelError: 0.0501 }])).toBe(false);
  });

  it('rejects a missing top value', () => {
    expect(withinBound([{ ...base, topMissing: ['b'] }])).toBe(false);
  });

  it('honours a custom bound', () => {
    expect(withinBound([{ ...base, topMaxRelError: 0.08 }], 0.1)).toBe(true);
  });
});
