import { describe, expect, it } from 'vitest';

import { mergeInferenceRules } from './configMerge';

describe('mergeInferenceRules', () => {
  it('returns incoming when no existing rules', () => {
    const incoming = [{ name: 'a', set: 1 }];
    expect(mergeInferenceRules(undefined, incoming)).toEqual(incoming);
  });

  it('returns existing when no incoming rules', () => {
    const existing = [{ name: 'a', set: 1 }];
    expect(mergeInferenceRules(existing, undefined)).toEqual(existing);
  });

  it('returns empty array when both undefined', () => {
    expect(mergeInferenceRules(undefined, undefined)).toEqual([]);
  });

  it('replaces existing rule by name', () => {
    const existing = [{ name: 'a', val: 1 }];
    const incoming = [{ name: 'a', val: 2 }];
    const result = mergeInferenceRules(existing, incoming);
    expect(result).toEqual([{ name: 'a', val: 2 }]);
  });

  it('appends new rules', () => {
    const existing = [{ name: 'a', val: 1 }];
    const incoming = [{ name: 'b', val: 2 }];
    const result = mergeInferenceRules(existing, incoming);
    expect(result).toEqual([
      { name: 'a', val: 1 },
      { name: 'b', val: 2 },
    ]);
  });

  it('appends rules without name', () => {
    const existing = [{ name: 'a', val: 1 }];
    const incoming = [{ val: 99 }];
    const result = mergeInferenceRules(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ val: 99 });
  });

  it('preserves order: existing first, new appended', () => {
    const existing = [
      { name: 'a', val: 1 },
      { name: 'b', val: 2 },
    ];
    const incoming = [
      { name: 'b', val: 20 },
      { name: 'c', val: 3 },
    ];
    const result = mergeInferenceRules(existing, incoming);
    expect(result).toEqual([
      { name: 'a', val: 1 },
      { name: 'b', val: 20 },
      { name: 'c', val: 3 },
    ]);
  });
});
