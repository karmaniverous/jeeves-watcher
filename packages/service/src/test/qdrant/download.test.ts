/**
 * @module test/qdrant/download.test
 * Tests for the pure parts of binary provisioning: cache location and archive digest verification.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { QDRANT_VERSION } from './assets';
import { qdrantCacheDir, verifyDigest } from './download';

describe('qdrantCacheDir', () => {
  it('defaults to node_modules/.cache/qdrant/<version> under cwd', () => {
    expect(qdrantCacheDir({})).toBe(
      join(process.cwd(), 'node_modules', '.cache', 'qdrant', QDRANT_VERSION),
    );
  });

  it('honours QDRANT_CACHE_DIR', () => {
    expect(qdrantCacheDir({ QDRANT_CACHE_DIR: join('x', 'y') })).toBe(
      join('x', 'y', QDRANT_VERSION),
    );
  });
});

describe('verifyDigest', () => {
  const data = new TextEncoder().encode('qdrant');
  const digest = createHash('sha256').update(data).digest('hex');

  it('accepts matching bytes', () => {
    expect(() => {
      verifyDigest(data, digest);
    }).not.toThrow();
  });

  it('rejects tampered bytes', () => {
    expect(() => {
      verifyDigest(new TextEncoder().encode('qdrant!'), digest);
    }).toThrow(/SHA-256 mismatch/);
  });
});
