/**
 * @module processor/fileOperations.test
 * Payload-only file operations through the processor: metadata and rules updates keep the stored `file_path` casing; rules re-apply and move drop keys the rules no longer project (enrichment kept); file enrichment is stored before indexing; enrichment cannot override `matched_rules`; rule interpolation failures of files are indexed as before and recorded as an `interpolation_error` issue.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import type { IssuesManager } from '../issues';
import type { IssueRecord } from '../issues/types';
import type { RuleApplicationError } from '../rules';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor } from './index';

vi.mock('./buildMetadata', () => ({ buildMergedMetadata: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  stat: vi.fn().mockResolvedValue({ birthtimeMs: 1000, mtimeMs: 2000 }),
  readFile: vi.fn().mockResolvedValue(Buffer.from('content')),
}));

import { buildMergedMetadata } from './buildMetadata';

const STORED_PATH = 'J:/Docs/Report.md';
const REQUESTED = 'j:\\docs\\report.md';

const templateError: RuleApplicationError = {
  rule: 'r',
  stage: 'template',
  message: 'boom',
};

function setup() {
  const issues: Record<string, IssueRecord[]> = {};
  const issuesManager = {
    record: vi.fn(
      (
        key: string,
        type: IssueRecord['type'],
        message: string,
        options: Partial<IssueRecord> = {},
      ) => {
        (issues[key] ??= []).push({ ...options, type, message, timestamp: 0 });
      },
    ),
    clear: vi.fn((key: string) => {
      Reflect.deleteProperty(issues, key);
    }),
    get: (key: string) => issues[key],
  };
  const vectorStore = {
    getPayload: vi.fn().mockResolvedValue({
      total_chunks: 1,
      file_path: STORED_PATH,
      matched_rules: ['r'],
    }),
    upsert: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    setPayload: vi.fn().mockResolvedValue(undefined),
    deletePayload: vi.fn().mockResolvedValue(undefined),
    getPointsWithVectors: vi.fn().mockResolvedValue([
      {
        id: 'old-0',
        vector: [0.1],
        payload: {
          file_path: '/old.md',
          chunk_index: 0,
          total_chunks: 1,
          domain: 'old',
          stale: 'gone from the rules',
        },
      },
    ]),
  };
  const enrichmentStore = {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    list: vi.fn(),
    close: vi.fn(),
  };
  const embeddingProvider: EmbeddingProvider = {
    dimensions: 1,
    embed: vi.fn().mockResolvedValue([[0.1]]),
  };
  const processor = new DocumentProcessor({
    config: {},
    embeddingProvider,
    vectorStore: vectorStore as unknown as VectorStoreClient,
    compiledRules: [],
    logger: pino({ level: 'silent' }),
    issuesManager: issuesManager as unknown as IssuesManager,
    enrichmentStore,
  });
  return { processor, vectorStore, issues, enrichmentStore };
}

function mockBuilt(ruleErrors: RuleApplicationError[] = []) {
  (buildMergedMetadata as Mock).mockResolvedValue({
    metadata: { domain: 'docs' },
    extracted: { text: 'hello world' },
    renderedContent: null,
    matchedRules: ['r'],
    renderAs: null,
    ruleErrors,
    metadataWithRules: { domain: 'docs', matched_rules: ['r'] },
    dates: { createdAt: 1, modifiedAt: 2 },
  });
}

describe('file operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuilt();
  });

  it('metadata update keeps the stored file_path and matched_rules', async () => {
    const { processor, vectorStore } = setup();
    await processor.processMetadataUpdate(REQUESTED, {
      title: 'x',
      matched_rules: ['enrichment'],
    });
    const payload = vectorStore.setPayload.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(payload['file_path']).toBe(STORED_PATH);
    expect(payload['title']).toBe('x');
    expect(payload).not.toHaveProperty('matched_rules');
  });

  it('rules update keeps the stored file_path casing', async () => {
    const { processor, vectorStore } = setup();
    await processor.processRulesUpdate(REQUESTED);
    expect(vectorStore.setPayload.mock.calls[0][1]).toMatchObject({
      file_path: STORED_PATH,
      matched_rules: ['r'],
      domain: 'docs',
    });
  });

  it('rules update removes keys the rules no longer project', async () => {
    const { processor, vectorStore } = setup();
    vectorStore.getPayload.mockResolvedValue({
      total_chunks: 2,
      file_path: STORED_PATH,
      matched_rules: ['r'],
      domain: 'docs',
      stale: 'x',
    });
    await processor.processRulesUpdate(REQUESTED);
    expect(vectorStore.deletePayload).toHaveBeenCalledWith(
      [expect.any(String), expect.any(String)],
      ['stale'],
    );
  });

  it('rules update writes nothing when the projection is unchanged', async () => {
    const { processor, vectorStore } = setup();
    vectorStore.getPayload.mockResolvedValue({
      total_chunks: 1,
      file_path: STORED_PATH,
      matched_rules: ['r'],
      domain: 'docs',
    });
    expect(await processor.processRulesUpdate(REQUESTED)).toEqual({
      domain: 'docs',
      matched_rules: ['r'],
    });
    expect(vectorStore.setPayload).not.toHaveBeenCalled();
    expect(vectorStore.deletePayload).not.toHaveBeenCalled();
  });

  it('move drops keys the rules no longer project, after moving enrichment', async () => {
    const { processor, vectorStore, enrichmentStore } = setup();
    await processor.moveFile('/old.md', '/new.md');
    const [points] = vectorStore.upsert.mock.calls[0] as [
      { payload: Record<string, unknown> }[],
    ];
    expect(points[0].payload).toMatchObject({
      file_path: '/new.md',
      domain: 'docs',
      chunk_index: 0,
    });
    expect(points[0].payload).not.toHaveProperty('stale');
    // Enrichment moves first, so the new path's metadata merges it.
    expect(enrichmentStore.move.mock.invocationCallOrder[0]).toBeLessThan(
      (buildMergedMetadata as Mock).mock.invocationCallOrder[0],
    );
  });

  it('metadata update stores enrichment for a file not yet indexed', async () => {
    const { processor, vectorStore, enrichmentStore } = setup();
    vectorStore.getPayload.mockResolvedValue(null);
    expect(
      await processor.processMetadataUpdate('/docs/new.md', { title: 't' }),
    ).toBeNull();
    expect(enrichmentStore.set).toHaveBeenCalledWith('/docs/new.md', {
      title: 't',
    });
    expect(vectorStore.setPayload).not.toHaveBeenCalled();
  });

  it('records a rules-update interpolation failure as an issue', async () => {
    mockBuilt([templateError]);
    const { processor, vectorStore, issues } = setup();
    await processor.processRulesUpdate(STORED_PATH);
    expect(vectorStore.setPayload).toHaveBeenCalledOnce();
    expect(issues[STORED_PATH]).toEqual([
      expect.objectContaining({
        type: 'interpolation_error',
        message: 'Rule "r" template failed: boom',
        details: [templateError],
      }),
    ]);
  });

  it('indexes a file whose template failed and records the issue once', async () => {
    mockBuilt([templateError]);
    const { processor, vectorStore, issues } = setup();
    vectorStore.getPayload.mockResolvedValue(null);
    await processor.processFile('/docs/a.md');
    expect(vectorStore.upsert).toHaveBeenCalledOnce();

    // Unchanged re-runs keep an upsert_error (issues are not cleared), so
    // only the dedupe stops a second interpolation issue.
    const upsertError = { type: 'upsert_error' as const, message: 'partial' };
    issues['/docs/a.md'].push({ ...upsertError, timestamp: 0 });
    vectorStore.getPayload.mockResolvedValue({
      content_hash: contentHash('hello world'),
      total_chunks: 1,
    });
    await processor.processFile('/docs/a.md');
    await processor.processFile('/docs/a.md');

    expect(vectorStore.upsert).toHaveBeenCalledOnce();
    expect(issues['/docs/a.md']).toEqual([
      expect.objectContaining({ type: 'interpolation_error', rules: ['r'] }),
      expect.objectContaining(upsertError),
    ]);
  });

  it('records a move interpolation failure under the new path', async () => {
    mockBuilt([templateError]);
    const { processor, issues } = setup();
    issues['/old.md'] = [
      { type: 'extraction_error', message: 'old', timestamp: 0 },
    ];
    await processor.moveFile('/old.md', '/new.md');
    expect(issues['/old.md']).toBeUndefined();
    expect(issues['/new.md']).toEqual([
      expect.objectContaining({
        type: 'interpolation_error',
        details: [templateError],
      }),
    ]);
  });

  it('records no issue when rules apply cleanly', async () => {
    const { processor, issues } = setup();
    await processor.processFile('/docs/a.md');
    expect(issues['/docs/a.md']).toBeUndefined();
  });
});
