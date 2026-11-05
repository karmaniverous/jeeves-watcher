/**
 * @module processor/indexFile.test
 * indexFile (D44): a file over maxFileBytes is rejected too_large from stat, before the resolver (extraction) runs, and its points are deleted; default ceilings apply without configured limits; a gone file indexes nothing.
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
  return {
    vectorStore,
    resolver,
    ctx: {
      embeddingProvider: {} as never,
      vectorStore: vectorStore as never,
      logger: pino({ level: 'silent' }),
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

  it('applies the default ceilings and indexes nothing for a gone file', async () => {
    const { ctx, resolver, vectorStore } = context();
    await expect(indexFile(ctx, file)).resolves.toBeUndefined();
    expect(resolver.resolve).toHaveBeenCalledWith(file);
    expect(vectorStore.delete).not.toHaveBeenCalled();
  });
});
