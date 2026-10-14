/**
 * @module processor/processingPipelineIssues.test
 * Tests that embedAndUpsertDocument tags embedding and vector-store failures with canonical issue codes (#255).
 */

import { describe, expect, it, vi } from 'vitest';

import { ProcessingFailure } from './issueRecording';
import { embedAndUpsertDocument } from './processingPipeline';

function makeDeps(overrides: {
  embed?: ReturnType<typeof vi.fn>;
  upsert?: ReturnType<typeof vi.fn>;
  del?: ReturnType<typeof vi.fn>;
  splitText?: ReturnType<typeof vi.fn>;
}) {
  return {
    embeddingProvider: {
      embed:
        overrides.embed ??
        vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [0]))),
    },
    vectorStore: {
      upsert: overrides.upsert ?? vi.fn().mockResolvedValue(undefined),
      delete: overrides.del ?? vi.fn().mockResolvedValue(undefined),
    },
    splitter: {
      splitText: overrides.splitText ?? vi.fn().mockResolvedValue(['a', 'b']),
    },
    logger: { info: vi.fn() },
  };
}

async function run(
  deps: ReturnType<typeof makeDeps>,
  existing: Record<string, unknown> | null = null,
): Promise<unknown> {
  return embedAndUpsertDocument(
    deps as never,
    {
      identity: { kind: 'file', filePath: 'f.md' },
      text: 'text',
      metadata: {},
      logLabel: 'File',
    },
    { existing, dates: { createdAt: 1, modifiedAt: 2 }, hash: 'h' },
  ).catch((e: unknown) => e);
}

describe('embedAndUpsertDocument issue tagging (#255)', () => {
  it('tags an embedding failure as embedding_error and skips upsert', async () => {
    const deps = makeDeps({ embed: vi.fn().mockRejectedValue(new Error('q')) });
    const err = await run(deps);
    expect(err).toBeInstanceOf(ProcessingFailure);
    expect((err as ProcessingFailure).issueType).toBe('embedding_error');
    expect(deps.vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('tags an upsert failure as upsert_error', async () => {
    const deps = makeDeps({
      upsert: vi.fn().mockRejectedValue(new Error('down')),
    });
    const err = await run(deps);
    expect((err as ProcessingFailure).issueType).toBe('upsert_error');
    expect((err as ProcessingFailure).message).toBe('down');
  });

  it('tags an orphan-delete failure as upsert_error', async () => {
    const deps = makeDeps({ del: vi.fn().mockRejectedValue(new Error('d')) });
    const err = await run(deps, { total_chunks: 5 });
    expect((err as ProcessingFailure).issueType).toBe('upsert_error');
  });

  it('leaves a splitter failure untagged (caller falls back to extraction_error)', async () => {
    const splitErr = new Error('split');
    const deps = makeDeps({ splitText: vi.fn().mockRejectedValue(splitErr) });
    expect(await run(deps)).toBe(splitErr);
  });

  it('upserts every chunk and deletes nothing for a new document', async () => {
    const deps = makeDeps({});
    expect(await run(deps)).toBe(2);
    expect(deps.vectorStore.upsert).toHaveBeenCalledOnce();
    const points = (
      deps.vectorStore.upsert.mock.calls[0] as unknown as [
        Array<{ payload: Record<string, unknown> }>,
      ]
    )[0];
    expect(points.map((p) => p.payload['chunk_text'])).toEqual(['a', 'b']);
    expect(deps.vectorStore.delete).not.toHaveBeenCalled();
  });
});
