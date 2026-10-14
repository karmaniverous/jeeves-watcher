/**
 * @module processor/processorIssues.test
 * DocumentProcessor issue recording (#255): extraction, embedding and upsert failures land in a real IssuesManager as typed issues and clear on later success.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { contentHash } from '../hash';
import { IssuesManager } from '../issues';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor } from './index';

vi.mock('./buildMetadata', () => ({ buildMergedMetadata: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  stat: vi.fn().mockResolvedValue({
    birthtimeMs: 1700000000000,
    mtimeMs: 1700100000000,
  }),
  readFile: vi.fn().mockResolvedValue(Buffer.from('mock file content')),
}));

import { buildMergedMetadata } from './buildMetadata';

const mockedBuild = buildMergedMetadata as Mock;
const FILE = '/docs/a.md';

function merged(text = 'hello world') {
  return {
    dates: { createdAt: 1700000000, modifiedAt: 1700100000 },
    metadata: { domain: 'test' },
    extracted: { text, frontmatter: null, json: null },
    renderedContent: null,
    matchedRules: ['rule1'],
  };
}

describe('DocumentProcessor issue recording (#255)', () => {
  let tempDir: string;
  let issues: IssuesManager;
  let vectorStore: Record<
    'getPayload' | 'upsert' | 'delete' | 'setPayload',
    Mock
  >;
  let embed: Mock;
  let processor: DocumentProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'processor-issues-'));
    const logger = pino({ level: 'silent' });
    issues = new IssuesManager(tempDir, logger);
    vectorStore = {
      getPayload: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      setPayload: vi.fn().mockResolvedValue(undefined),
    };
    embed = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
    processor = new DocumentProcessor({
      config: { chunkSize: 1000, chunkOverlap: 200 },
      embeddingProvider: { dimensions: 3, embed },
      vectorStore: vectorStore as unknown as VectorStoreClient,
      compiledRules: [],
      logger,
      issuesManager: issues,
    });
    mockedBuild.mockResolvedValue(merged());
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('records extraction_error when metadata extraction fails', async () => {
    mockedBuild.mockRejectedValue(new Error('cannot read'));
    await processor.processFile(FILE);
    expect(issues.get(FILE)).toEqual([
      expect.objectContaining({
        type: 'extraction_error',
        operation: 'Failed to process file',
        message: 'cannot read',
      }),
    ]);
  });

  it('records embedding_error when the provider fails, without upserting', async () => {
    embed.mockRejectedValue(new Error('429 quota'));
    await processor.processFile(FILE);
    expect(issues.get(FILE)?.[0]).toMatchObject({
      type: 'embedding_error',
      message: '429 quota',
    });
    expect(vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('records upsert_error when the vector store write fails', async () => {
    vectorStore.upsert.mockRejectedValue(new Error('qdrant down'));
    await processor.processFile(FILE);
    expect(issues.get(FILE)?.[0]).toMatchObject({
      type: 'upsert_error',
      message: 'qdrant down',
    });
  });

  it('keeps only the latest failure for a file', async () => {
    embed.mockRejectedValueOnce(new Error('first'));
    vectorStore.upsert.mockRejectedValueOnce(new Error('second'));
    await processor.processFile(FILE);
    await processor.processFile(FILE);
    expect(issues.get(FILE)).toHaveLength(1);
    expect(issues.get(FILE)?.[0]?.type).toBe('upsert_error');
  });

  it('clears the issue when the file later processes successfully', async () => {
    embed.mockRejectedValueOnce(new Error('transient'));
    await processor.processFile(FILE);
    expect(issues.get(FILE)).toBeDefined();

    await processor.processFile(FILE);
    expect(vectorStore.upsert).toHaveBeenCalledOnce();
    expect(issues.get(FILE)).toBeUndefined();
  });

  it('clears an extraction_error when content is unchanged on retry', async () => {
    mockedBuild.mockRejectedValueOnce(new Error('rule broke'));
    await processor.processFile(FILE);
    vectorStore.getPayload.mockResolvedValue({
      content_hash: contentHash('hello world'),
      total_chunks: 1,
    });

    await processor.processFile(FILE);
    expect(vectorStore.upsert).not.toHaveBeenCalled();
    expect(issues.get(FILE)).toBeUndefined();
  });

  it('keeps an upsert_error when content is unchanged on retry', async () => {
    issues.record(FILE, 'upsert_error', 'partial');
    vectorStore.getPayload.mockResolvedValue({
      content_hash: contentHash('hello world'),
      total_chunks: 1,
    });
    await processor.processFile(FILE);
    expect(issues.get(FILE)?.[0]?.type).toBe('upsert_error');
  });

  it('records upsert_error when re-applying rules fails to write payloads', async () => {
    vectorStore.getPayload.mockResolvedValue({ total_chunks: 2 });
    vectorStore.setPayload.mockRejectedValue(new Error('write failed'));
    await expect(processor.processRulesUpdate(FILE)).resolves.toBeNull();
    expect(issues.get(FILE)?.[0]).toMatchObject({
      type: 'upsert_error',
      operation: 'Failed to re-apply rules',
    });
  });

  it('records a move failure under the new path', async () => {
    const points = [{ id: 'x', vector: [0], payload: {} }];
    const getPoints = vi.fn().mockResolvedValue(points);
    Object.assign(vectorStore, { getPointsWithVectors: getPoints });
    vectorStore.upsert.mockRejectedValue(new Error('qdrant down'));
    await processor.moveFile('/docs/old.md', FILE);
    expect(issues.get(FILE)?.[0]).toMatchObject({
      type: 'upsert_error',
      operation: 'Failed to move file',
    });

    vectorStore.upsert.mockResolvedValue(undefined);
    await processor.moveFile('/docs/old.md', FILE);
    expect(issues.get(FILE)).toBeUndefined();
  });

  it('does not record an issue when deleting a file fails', async () => {
    vectorStore.delete.mockRejectedValue(new Error('qdrant down'));
    await processor.deleteFile(FILE);
    expect(issues.getAll()).toEqual({});
  });
});
