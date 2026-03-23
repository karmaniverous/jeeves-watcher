/**
 * @module cache/ContentHashCache.test
 * Tests for ContentHashCache.
 */

import { describe, expect, it } from 'vitest';

import { ContentHashCache } from './ContentHashCache';

describe('ContentHashCache', () => {
  it('stores and retrieves a hash', () => {
    const cache = new ContentHashCache();
    cache.set('/a/b.txt', 'abc123');
    expect(cache.get('/a/b.txt')).toBe('abc123');
  });

  it('returns undefined for unknown path', () => {
    const cache = new ContentHashCache();
    expect(cache.get('/unknown.txt')).toBeUndefined();
  });

  it('normalizes paths on set and get', () => {
    const cache = new ContentHashCache();
    cache.set('C:\\docs\\file.txt', 'hash1');
    expect(cache.get('c:/docs/file.txt')).toBe('hash1');
  });

  it('deletes an entry', () => {
    const cache = new ContentHashCache();
    cache.set('/a.txt', 'hash1');
    cache.delete('/a.txt');
    expect(cache.get('/a.txt')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('updates hash for existing path', () => {
    const cache = new ContentHashCache();
    cache.set('/a.txt', 'old');
    cache.set('/a.txt', 'new');
    expect(cache.get('/a.txt')).toBe('new');
    expect(cache.getByHash('old')).toEqual([]);
    expect(cache.getByHash('new')).toHaveLength(1);
  });

  it('reverse lookup returns paths by hash', () => {
    const cache = new ContentHashCache();
    cache.set('/a.txt', 'same');
    cache.set('/b.txt', 'same');
    cache.set('/c.txt', 'other');

    const matches = cache.getByHash('same');
    expect(matches).toHaveLength(2);
    expect(cache.getByHash('other')).toHaveLength(1);
    expect(cache.getByHash('missing')).toEqual([]);
  });

  it('cleans up reverse index on delete', () => {
    const cache = new ContentHashCache();
    cache.set('/a.txt', 'hash1');
    cache.set('/b.txt', 'hash1');
    cache.delete('/a.txt');
    expect(cache.getByHash('hash1')).toHaveLength(1);
  });

  it('cleans up reverse index when hash changes', () => {
    const cache = new ContentHashCache();
    cache.set('/a.txt', 'hash1');
    cache.set('/b.txt', 'hash1');
    cache.set('/a.txt', 'hash2');
    expect(cache.getByHash('hash1')).toHaveLength(1);
    expect(cache.getByHash('hash2')).toHaveLength(1);
  });

  it('reports correct size', () => {
    const cache = new ContentHashCache();
    expect(cache.size).toBe(0);
    cache.set('/a.txt', 'h1');
    cache.set('/b.txt', 'h2');
    expect(cache.size).toBe(2);
    cache.delete('/a.txt');
    expect(cache.size).toBe(1);
  });

  it('delete is idempotent for unknown path', () => {
    const cache = new ContentHashCache();
    cache.delete('/not-there.txt');
    expect(cache.size).toBe(0);
  });
});
