/**
 * @module enrichment/EnrichmentStore.source.test
 * Source references are stored verbatim (case-sensitive), unlike file paths.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EnrichmentStore } from './EnrichmentStore';

let stateDir: string;
let store: EnrichmentStore;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'enrichment-source-test-'));
  store = new EnrichmentStore(stateDir);
});

afterEach(() => {
  store.close();
  rmSync(stateDir, { recursive: true, force: true });
});

describe('EnrichmentStore with source references', () => {
  it('keys references case-sensitively and without normalisation', () => {
    store.set('app://chat/thread/AbC', { a: 1 });
    store.set('app://chat/thread/abc', { b: 2 });

    expect(store.get('app://chat/thread/AbC')).toEqual({ a: 1 });
    expect(store.get('app://chat/thread/abc')).toEqual({ b: 2 });
    expect(store.list()).toEqual([
      'app://chat/thread/AbC',
      'app://chat/thread/abc',
    ]);
  });

  it('deletes only the exact reference', () => {
    store.set('app://chat/thread/AbC', { a: 1 });
    store.delete('app://chat/thread/abc');
    expect(store.get('app://chat/thread/AbC')).toEqual({ a: 1 });
    store.delete('app://chat/thread/AbC');
    expect(store.get('app://chat/thread/AbC')).toBeNull();
  });

  it('still normalises file paths', () => {
    store.set('J:\\Docs\\A.md', { a: 1 });
    expect(store.list()).toEqual(['j:/docs/a.md']);
  });
});
