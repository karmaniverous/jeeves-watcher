/**
 * @module test/qdrant/download.test
 * Tests for binary provisioning: cache location, archive digest verification, and re-verifying a cached executable against its pinned digest (temp files).
 */

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { QDRANT_VERSION } from './assets';
import { qdrantCacheDir, verifyBinaryDigest, verifyDigest } from './download';

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

describe('verifyBinaryDigest', () => {
  let dir: string;
  const bytes = new TextEncoder().encode('pretend executable');
  const digest = createHash('sha256').update(bytes).digest('hex');

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-digest-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts a cached executable with the pinned digest', async () => {
    const file = join(dir, 'ok');
    await writeFile(file, bytes);
    await expect(verifyBinaryDigest(file, digest)).resolves.toBeUndefined();
  });

  it('rejects a modified cached executable', async () => {
    const file = join(dir, 'tampered');
    await writeFile(file, new TextEncoder().encode('pretend executable!'));
    await expect(verifyBinaryDigest(file, digest)).rejects.toThrow(
      /Qdrant executable SHA-256 mismatch/,
    );
  });
});
