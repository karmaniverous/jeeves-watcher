/**
 * @module templates/resolveFrontmatterKeys.test
 * Tests for resolveFrontmatterKeys.
 */

import { describe, expect, it } from 'vitest';

import { resolveFrontmatterKeys } from './resolveFrontmatterKeys';

describe('resolveFrontmatterKeys', () => {
  const allKeys = [
    'meta_id',
    'meta_steer',
    'name',
    'type',
    'status',
    '_content',
    '_error',
    'chunk_index',
    'file_path',
  ];

  it('returns explicit names in declaration order (backward compat)', () => {
    expect(resolveFrontmatterKeys(['meta_id', 'name'], allKeys)).toEqual([
      'meta_id',
      'name',
    ]);
  });

  it('expands * to all keys sorted alphabetically', () => {
    const result = resolveFrontmatterKeys(['*'], allKeys);
    expect(result).toEqual([...allKeys].sort());
  });

  it('applies ! exclusion patterns', () => {
    const result = resolveFrontmatterKeys(['*', '!_*'], allKeys);
    expect(result).not.toContain('_content');
    expect(result).not.toContain('_error');
    expect(result).toContain('meta_id');
    expect(result).toContain('name');
  });

  it('combines explicit names, globs, and exclusions', () => {
    const result = resolveFrontmatterKeys(
      ['meta_id', '*', '!_*', '!chunk_*'],
      allKeys,
    );
    // meta_id first (explicit), then remaining non-excluded sorted
    expect(result[0]).toBe('meta_id');
    expect(result).not.toContain('_content');
    expect(result).not.toContain('_error');
    expect(result).not.toContain('chunk_index');
    expect(result).toContain('name');
    expect(result).toContain('file_path');
  });

  it('excludes explicit names that match exclusion patterns', () => {
    const result = resolveFrontmatterKeys(['_content', '!_*'], allKeys);
    expect(result).toEqual([]);
  });

  it('handles empty context gracefully', () => {
    expect(resolveFrontmatterKeys(['*'], [])).toEqual([]);
  });

  it('handles empty patterns gracefully', () => {
    expect(resolveFrontmatterKeys([], allKeys)).toEqual([]);
  });

  it('ignores explicit names not present in context', () => {
    expect(resolveFrontmatterKeys(['nonexistent', 'meta_id'], allKeys)).toEqual(
      ['meta_id'],
    );
  });

  it('deduplicates when explicit name also matches glob', () => {
    const result = resolveFrontmatterKeys(['meta_id', '*'], allKeys);
    const count = result.filter((k) => k === 'meta_id').length;
    expect(count).toBe(1);
    // meta_id should be first (explicit ordering)
    expect(result[0]).toBe('meta_id');
  });

  it('supports prefix glob patterns', () => {
    const result = resolveFrontmatterKeys(['meta_*'], allKeys);
    expect(result).toEqual(['meta_id', 'meta_steer']);
  });
});
