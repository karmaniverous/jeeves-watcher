/**
 * @module enrichment/EnrichmentStore.test
 * Tests for SQLite-backed EnrichmentStore.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EnrichmentStore } from './EnrichmentStore';

let stateDir: string;
let store: EnrichmentStore;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'enrichment-test-'));
  store = new EnrichmentStore(stateDir);
});

afterEach(() => {
  store.close();
  rmSync(stateDir, { recursive: true, force: true });
});

describe('EnrichmentStore', () => {
  describe('get/set', () => {
    it('returns null for unknown path', () => {
      expect(store.get('/unknown.txt')).toBeNull();
    });

    it('stores and retrieves metadata', () => {
      store.set('/file.txt', { domain: 'test', tags: ['a'] });
      const result = store.get('/file.txt');
      expect(result).toEqual({ domain: 'test', tags: ['a'] });
    });

    it('merges metadata on subsequent set', () => {
      store.set('/file.txt', { domain: 'test' });
      store.set('/file.txt', { category: 'docs' });
      const result = store.get('/file.txt');
      expect(result).toEqual({ domain: 'test', category: 'docs' });
    });

    it('overwrites existing keys on merge', () => {
      store.set('/file.txt', { domain: 'old' });
      store.set('/file.txt', { domain: 'new' });
      expect(store.get('/file.txt')).toEqual({ domain: 'new' });
    });

    it('normalizes paths (case, slashes)', () => {
      store.set('D:\\Files\\Doc.txt', { x: 1 });
      expect(store.get('d:/files/doc.txt')).toEqual({ x: 1 });
    });
  });

  describe('delete', () => {
    it('removes metadata for a path', () => {
      store.set('/file.txt', { x: 1 });
      store.delete('/file.txt');
      expect(store.get('/file.txt')).toBeNull();
    });

    it('no-ops for unknown path', () => {
      expect(() => {
        store.delete('/unknown.txt');
      }).not.toThrow();
    });
  });

  describe('move', () => {
    it('moves metadata from old path to new path', () => {
      store.set('/old/file.txt', { domain: 'test' });
      store.move('/old/file.txt', '/new/file.txt');
      expect(store.get('/old/file.txt')).toBeNull();
      expect(store.get('/new/file.txt')).toEqual({ domain: 'test' });
    });

    it('no-ops when source does not exist', () => {
      store.move('/missing.txt', '/dest.txt');
      expect(store.get('/dest.txt')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns empty array for empty store', () => {
      expect(store.list()).toEqual([]);
    });

    it('returns all enriched paths sorted', () => {
      store.set('/b.txt', { x: 1 });
      store.set('/a.txt', { x: 2 });
      expect(store.list()).toEqual(['/a.txt', '/b.txt']);
    });
  });

  describe('persistence', () => {
    it('survives close and reopen', () => {
      store.set('/file.txt', { persistent: true });
      store.close();

      const store2 = new EnrichmentStore(stateDir);
      expect(store2.get('/file.txt')).toEqual({ persistent: true });
      store2.close();

      // Reassign so afterEach close doesn't fail
      store = new EnrichmentStore(stateDir);
    });
  });
});
