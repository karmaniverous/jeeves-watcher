/**
 * @module api/executeReindex.sources.test
 * executeReindex with source documents: `full` forces re-embed, `rules` updates payloads only when content is unchanged, `issues` picks only issue references, plans count per source name, progress covers sources.
 */

import { describe, expect, it, vi } from 'vitest';

import { sourcePointId } from '../pointId';
import {
  chatRules,
  doc,
  type Responses,
  RULE,
  sourceReindexFixture,
} from '../test/sourceReindexFixture';
import { executeReindex } from './executeReindex';
import { ReindexTracker } from './ReindexTracker';

vi.mock('./fileScan', () => ({
  listFilesFromGlobs: vi.fn().mockResolvedValue(['src/a.md']),
  listFilesFromWatchRoots: vi.fn().mockResolvedValue([]),
}));

const A = 'app://chat/thread/a';
const B = 'app://chat/thread/b';
const C = 'kb://notes/c';

function fixture() {
  const responses: Responses = {
    [A]: doc('u1', 'alpha'),
    [B]: doc('u2', 'bravo'),
    [C]: doc('u3', 'charlie'),
  };
  const f = sourceReindexFixture(responses);
  // File processing is out of scope here.
  const processFile = vi
    .spyOn(f.processor, 'processFile')
    .mockResolvedValue(undefined);
  vi.spyOn(f.processor, 'processRulesUpdate').mockResolvedValue(null);
  return { ...f, responses, processFile };
}

describe('executeReindex: source documents', () => {
  it('full re-retrieves every indexed source and re-embeds unchanged content', async () => {
    const f = fixture();
    await f.index(A, B);

    const result = await executeReindex(f.deps, 'full');

    expect(f.retrieve.mock.calls.map(([ref]) => ref).sort()).toEqual([A, B]);
    expect(f.embed).toHaveBeenCalledTimes(2);
    expect(result.sources).toEqual({
      indexed: 2,
      unchanged: 0,
      deleted: 0,
      failed: 0,
    });
    expect(result.errors).toBe(0);
    expect(result.filesProcessed).toBe(1);
  });

  it('full discovers sources from chunk-0 points carrying source', async () => {
    const f = fixture();
    await f.index(A);
    await executeReindex(f.deps, 'full');
    const [filter, , , fields] = f.store.scrollPage.mock
      .calls[0] as unknown as [unknown, unknown, unknown, string[]];
    expect(filter).toEqual({
      must: [{ key: 'chunk_index', match: { value: 0 } }],
      must_not: [{ is_empty: { key: 'source' } }],
    });
    expect(fields).toEqual(['source', 'source_rule']);
  });

  it('dry-run plans count files per root and sources per name', async () => {
    const f = fixture();
    await f.index(A, B, C);

    const { plan } = await executeReindex(f.deps, 'full', undefined, true);

    expect(plan).toEqual({
      total: 4,
      toProcess: 4,
      toDelete: 0,
      byRoot: { src: 1, app: 2, kb: 1 },
    });
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(f.embed).not.toHaveBeenCalled();
  });

  it('progress covers files and sources', async () => {
    const f = fixture();
    await f.index(A, B);
    const tracker = new ReindexTracker();
    const setTotal = vi.spyOn(tracker, 'setTotal');
    const increment = vi.spyOn(tracker, 'incrementProcessed');

    await executeReindex({ ...f.deps, reindexTracker: tracker }, 'rules');

    expect(setTotal).toHaveBeenLastCalledWith(3);
    expect(increment).toHaveBeenCalledTimes(3);
  });

  it('rules updates payloads only when the rendered content is unchanged', async () => {
    const f = fixture();
    await f.index(A, B);
    f.processor.updateRules(
      chatRules({ channel: { type: 'string', set: 'web' } }),
    );
    f.responses[B] = doc('u2', 'bravo edited');

    const result = await executeReindex(f.deps, 'rules');

    // A: same content, new metadata → setPayload, no embedding.
    expect(f.store.points.get(sourcePointId(A, 0))?.payload).toMatchObject({
      channel: 'web',
      source: A,
      source_rule: RULE,
    });
    // B: content changed → re-embedded once (A never embedded).
    expect(f.embed).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.embed.mock.calls[0])).toContain('bravo edited');
    expect(
      f.store.points.get(sourcePointId(B, 0))?.payload['chunk_text'],
    ).toContain('bravo edited');
    expect(f.store.setPayload).toHaveBeenCalledTimes(1);
    expect(result.sources).toMatchObject({ indexed: 2, failed: 0 });
  });

  it('rules leaves unchanged documents alone', async () => {
    const f = fixture();
    await f.index(A);
    const result = await executeReindex(f.deps, 'rules');
    expect(f.retrieve).toHaveBeenCalledOnce();
    expect(f.embed).not.toHaveBeenCalled();
    expect(f.store.setPayload).not.toHaveBeenCalled();
    expect(result.sources).toMatchObject({ unchanged: 1 });
  });

  it('rules with a path filter stays file-only', async () => {
    const f = fixture();
    await f.index(A);
    const result = await executeReindex(f.deps, 'rules', ['**/*.md']);
    expect(f.store.scrollPage).not.toHaveBeenCalled();
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(result.sources).toBeUndefined();
  });

  it('issues re-retrieves only source references with issues', async () => {
    const f = fixture();
    await f.index(A, B);
    f.issues.record(A, 'source_unavailable', 'HTTP 503');
    f.issues.record('app://chat/thread/never-indexed', 'match_failed', 'x');
    f.issues.record('src/broken.md', 'extraction_error', 'y');

    const plan = await executeReindex(f.deps, 'issues', undefined, true);
    expect(plan.plan).toEqual({
      total: 3,
      toProcess: 2,
      toDelete: 0,
      byRoot: { src: 1, app: 1 },
    });

    const result = await executeReindex(f.deps, 'issues');

    expect(f.retrieve.mock.calls.map(([ref]) => ref)).toEqual([A]);
    expect(f.processFile).toHaveBeenCalledTimes(1);
    expect(f.processFile).toHaveBeenCalledWith('src/broken.md');
    expect(f.embed).not.toHaveBeenCalled();
    expect(f.issues.get(A)).toBeUndefined();
    expect(result.sources).toMatchObject({ unchanged: 1 });
  });

  it('issues retries a never-indexed document with its recorded rule', async () => {
    const f = fixture();
    const never = 'app://chat/thread/never-indexed';
    f.issues.record(never, 'source_unavailable', 'HTTP 503', { rule: RULE });
    f.responses[never] = doc('u9', 'recovered');

    const result = await executeReindex(f.deps, 'issues');

    expect(f.retrieve.mock.calls.map(([ref]) => ref)).toEqual([never]);
    expect(f.store.points.get(sourcePointId(never, 0))?.payload).toMatchObject({
      source: never,
      source_rule: RULE,
    });
    expect(f.issues.get(never)).toBeUndefined();
    expect(result.sources).toMatchObject({ indexed: 1, failed: 0 });
  });
});
