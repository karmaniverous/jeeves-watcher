import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteMetadata,
  metadataPath,
  readMetadata,
  writeMetadata,
} from './metadata';

describe('metadata', () => {
  let metadataDir: string;

  beforeEach(async () => {
    metadataDir = await mkdtemp(join(tmpdir(), 'jw-meta-'));
  });

  afterEach(async () => {
    await rm(metadataDir, { recursive: true, force: true });
  });

  describe('metadataPath', () => {
    it('returns a .meta.json path under metadataDir', () => {
      const p = metadataPath('/some/file.ts', metadataDir);
      expect(p).toContain(metadataDir);
      expect(p).toMatch(/\.meta\.json$/);
    });

    it('is deterministic for the same input', () => {
      const p1 = metadataPath('/some/file.ts', metadataDir);
      const p2 = metadataPath('/some/file.ts', metadataDir);
      expect(p1).toBe(p2);
    });

    it('differs for different files', () => {
      const p1 = metadataPath('/some/file.ts', metadataDir);
      const p2 = metadataPath('/some/other.ts', metadataDir);
      expect(p1).not.toBe(p2);
    });
  });

  describe('writeMetadata + readMetadata', () => {
    it('round-trips metadata', async () => {
      const data = { title: 'Test', tags: ['a', 'b'], count: 42 };
      await writeMetadata('/test/file.md', metadataDir, data);
      const result = await readMetadata('/test/file.md', metadataDir);
      expect(result).toEqual(data);
    });

    it('writes valid JSON', async () => {
      await writeMetadata('/test/file.md', metadataDir, { key: 'value' });
      const p = metadataPath('/test/file.md', metadataDir);
      const raw = await readFile(p, 'utf8');
      expect(() => JSON.parse(raw) as unknown).not.toThrow();
    });
  });

  describe('readMetadata', () => {
    it('returns null for non-existent file', async () => {
      const result = await readMetadata('/no/such/file.ts', metadataDir);
      expect(result).toBeNull();
    });
  });

  describe('deleteMetadata', () => {
    it('removes the metadata file', async () => {
      await writeMetadata('/test/file.md', metadataDir, { x: 1 });
      const p = metadataPath('/test/file.md', metadataDir);
      expect(existsSync(p)).toBe(true);

      await deleteMetadata('/test/file.md', metadataDir);
      expect(existsSync(p)).toBe(false);
    });

    it('does not throw for non-existent file', async () => {
      await expect(
        deleteMetadata('/no/file.ts', metadataDir),
      ).resolves.toBeUndefined();
    });
  });
});
