/**
 * @module processor/indexFile.test
 * indexFile (D44, D201): a file over maxFileBytes is rejected too_large from stat, before the resolver (extraction) runs, and its points are deleted; default ceilings apply without configured limits; a gone file indexes nothing; an extraction failure deletes an indexed file's points and rethrows (a file with no points gets no delete, a system error reading the file deletes nothing, and a failing delete still rethrows the extraction error).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { pointId } from '../pointId';
import { indexFile } from './indexFile';
import { ProcessingFailure } from './issueRecording';

let dir: string;
let file: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-indexfile-'));
  file = join(dir, 'a.md');
  await writeFile(file, '0123456789', 'utf8');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function context(limits?: { maxFileBytes: number }) {
  const vectorStore = {
    getPayload: vi.fn().mockResolvedValue({ total_chunks: 2 }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const resolver = { resolve: vi.fn().mockResolvedValue({ kind: 'gone' }) };
  const logger = pino({ level: 'silent' });
  return {
    vectorStore,
    resolver,
    logger,
    ctx: {
      embeddingProvider: {} as never,
      vectorStore: vectorStore as never,
      logger,
      resolver,
      ...(limits
        ? { limits: { maxChunksPerFile: 5000, maxTextBytes: 1e6, ...limits } }
        : {}),
    },
  };
}

describe('indexFile', () => {
  it('rejects a file over maxFileBytes before extraction, deleting its points', async () => {
    const { ctx, resolver, vectorStore } = context({ maxFileBytes: 9 });
    const error = await indexFile(ctx, file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProcessingFailure);
    expect((error as ProcessingFailure).issueType).toBe('too_large');
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(vectorStore.delete).toHaveBeenCalledWith([
      pointId(file, 0),
      pointId(file, 1),
    ]);
  });

  describe('when extraction fails (D201)', () => {
    const failure = new Error('front matter is not valid YAML');

    it('deletes the points of an indexed file, then rethrows', async () => {
      const { ctx, resolver, vectorStore, logger } = context();
      resolver.resolve.mockRejectedValue(failure);
      const warn = vi.spyOn(logger, 'warn');
      await expect(indexFile(ctx, file)).rejects.toBe(failure);
      expect(vectorStore.getPayload).toHaveBeenCalledExactlyOnceWith(
        pointId(file, 0),
      );
      expect(vectorStore.delete).toHaveBeenCalledWith([
        pointId(file, 0),
        pointId(file, 1),
      ]);
      expect(warn).toHaveBeenCalledWith(
        { filePath: file, chunks: 2 },
        expect.stringContaining('removed from the index'),
      );
    });

    it.each(['EBUSY', 'EPERM', 'EMFILE', 'ENOENT', 'EIO'])(
      'keeps the points on a system error reading the file (%s)',
      async (code) => {
        const { ctx, resolver, vectorStore } = context();
        const systemError = Object.assign(new Error(`${code}: read`), {
          code,
          syscall: 'open',
        });
        resolver.resolve.mockRejectedValue(systemError);
        await expect(indexFile(ctx, file)).rejects.toBe(systemError);
        expect(vectorStore.getPayload).not.toHaveBeenCalled();
        expect(vectorStore.delete).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        'a code but no syscall',
        Object.assign(new Error('bad tag'), { code: 'TAG_RESOLVE_FAILED' }),
      ],
      [
        'a syscall but no code',
        Object.assign(new Error('odd'), { syscall: 'open' }),
      ],
      ['a non-Error value', 'boom'],
    ])('deletes for %s (not the OS)', async (_, thrown) => {
      const { ctx, resolver, vectorStore } = context();
      resolver.resolve.mockRejectedValue(thrown);
      await expect(indexFile(ctx, file)).rejects.toBe(thrown);
      expect(vectorStore.delete).toHaveBeenCalledOnce();
    });

    it('deletes nothing for a file with no points', async () => {
      const { ctx, resolver, vectorStore } = context();
      resolver.resolve.mockRejectedValue(failure);
      vectorStore.getPayload.mockResolvedValue(null);
      await expect(indexFile(ctx, file)).rejects.toBe(failure);
      expect(vectorStore.delete).not.toHaveBeenCalled();
    });

    it('logs a failing delete and still rethrows the extraction error', async () => {
      const { ctx, resolver, vectorStore, logger } = context();
      resolver.resolve.mockRejectedValue(failure);
      vectorStore.delete.mockRejectedValue(new Error('qdrant down'));
      const error = vi.spyOn(logger, 'error');
      await expect(indexFile(ctx, file)).rejects.toBe(failure);
      const [fields, message] = error.mock.calls[0] as unknown as [
        { filePath: string; err: { message: string } },
        string,
      ];
      expect(fields.filePath).toBe(file);
      expect(fields.err.message).toBe('qdrant down');
      expect(message).toContain('deleting the file from the index failed');
    });
  });

  it('applies the default ceilings and indexes nothing for a gone file', async () => {
    const { ctx, resolver, vectorStore } = context();
    await expect(indexFile(ctx, file)).resolves.toBeUndefined();
    expect(resolver.resolve).toHaveBeenCalledWith(file);
    expect(vectorStore.delete).not.toHaveBeenCalled();
  });
});
