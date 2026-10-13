/**
 * @module processor/fileOperations.test
 * Payload-only file operations through the processor: metadata and rules updates keep the stored `file_path` casing; enrichment cannot override `matched_rules`; rule interpolation failures of files are indexed as before and recorded as an `interpolation_error` issue.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { EmbeddingProvider } from '../embedding';
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
  });
  return { processor, vectorStore, issues };
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
    await processor.processFile('/docs/a.md');
    expect(vectorStore.upsert).toHaveBeenCalled();
    expect(issues['/docs/a.md']).toEqual([
      expect.objectContaining({ type: 'interpolation_error', rules: ['r'] }),
    ]);
  });

  it('records no issue when rules apply cleanly', async () => {
    const { processor, issues } = setup();
    await processor.processFile('/docs/a.md');
    expect(issues['/docs/a.md']).toBeUndefined();
  });
});
