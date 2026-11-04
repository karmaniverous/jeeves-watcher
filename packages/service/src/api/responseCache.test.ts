/**
 * @module api/responseCache.test
 * `hashObject`: distinct inputs hash apart, equal values hash equally.
 */

import { describe, expect, it } from 'vitest';

import { hashObject } from './responseCache';

describe('hashObject', () => {
  it('keeps undefined, null and distinct strings and objects apart', () => {
    const hashes = [undefined, null, 'null', '"x"', 'x', { a: 1 }].map(
      hashObject,
    );
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('hashes equal values equally', () => {
    expect(hashObject({ a: [1, 2] })).toBe(hashObject({ a: [1, 2] }));
  });
});
