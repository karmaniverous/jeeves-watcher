/**
 * @module enrichment/merge.test
 * Tests for composable merge utility.
 */

import { describe, expect, it } from 'vitest';

import { mergeEnrichment } from './merge';

describe('mergeEnrichment', () => {
  it('scalar: enrichment overwrites inferred', () => {
    const result = mergeEnrichment(
      { domain: 'inferred' },
      { domain: 'enriched' },
    );
    expect(result.domain).toBe('enriched');
  });

  it('array: union merge with deduplication', () => {
    const result = mergeEnrichment(
      { domains: ['jira', 'github'] },
      { domains: ['github', 'important'] },
    );
    expect(result.domains).toEqual(['jira', 'github', 'important']);
  });

  it('adds new keys from enrichment', () => {
    const result = mergeEnrichment({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('preserves inferred keys not in enrichment', () => {
    const result = mergeEnrichment({ a: 1, b: 2 }, { b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it('handles empty enrichment', () => {
    const result = mergeEnrichment({ a: 1 }, {});
    expect(result).toEqual({ a: 1 });
  });

  it('handles empty inferred', () => {
    const result = mergeEnrichment({}, { a: 1 });
    expect(result).toEqual({ a: 1 });
  });

  it('enrichment array overwrites inferred scalar', () => {
    const result = mergeEnrichment({ tags: 'single' }, { tags: ['a', 'b'] });
    expect(result.tags).toEqual(['a', 'b']);
  });

  it('enrichment scalar overwrites inferred array', () => {
    const result = mergeEnrichment({ tags: ['a', 'b'] }, { tags: 'single' });
    expect(result.tags).toBe('single');
  });

  it('handles null values in enrichment', () => {
    const result = mergeEnrichment({ a: 1 }, { a: null });
    expect(result.a).toBeNull();
  });
});
