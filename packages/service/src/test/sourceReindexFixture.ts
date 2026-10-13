/**
 * @module test/sourceReindexFixture
 * Unit-test fixture for source reindex: an in-memory vector store (point map, chunk-0/source filter on scroll), in-memory issues, a scripted source retriever, a real DocumentProcessor and a started notify queue over it. No I/O.
 */

import pino from 'pino';
import { vi } from 'vitest';

import type { ExecuteReindexDeps } from '../api/executeReindex';
import { createNotifyQueue } from '../app/sources';
import type { InferenceRule } from '../config/types';
import type { IssuesManager } from '../issues';
import type { IssueRecord } from '../issues/types';
import { pointId } from '../pointId';
import { DocumentProcessor } from '../processor';
import { compileRules } from '../rules';
import type { SourceRetrievalResult, SourceRetriever } from '../sources';
import type { VectorStoreClient } from '../vectorStore';

/** The designated rule used by the fixture (no template: JSON is embedded). */
export const RULE = 'chat';

/**
 * The fixture's rule set, optionally with extra projected properties.
 *
 * @param extra - Extra schema properties (e.g. a new `set`).
 * @returns Compiled rules.
 */
export function chatRules(extra: Record<string, unknown> = {}) {
  const rules: InferenceRule[] = [
    {
      name: RULE,
      description: 'Chat',
      match: { type: 'object', required: ['source', 'json'] },
      schema: [
        {
          type: 'object',
          properties: {
            user_id: { type: 'string', set: '{{json.userId}}' },
            ...extra,
          },
        },
      ],
    },
  ];
  return compileRules(rules);
}

/** A stored point. */
interface StoredPoint {
  id: string;
  payload: Record<string, unknown>;
}

/** Whether a scroll filter asks for chunk-0 source points only. */
function isSourceDiscovery(filter: unknown): boolean {
  return JSON.stringify(filter ?? {}).includes('is_empty');
}

/** In-memory vector store covering what reindex and the processor use. */
function memoryVectorStore() {
  const points = new Map<string, StoredPoint>();
  return {
    points,
    getPayload: vi.fn((id: string) =>
      Promise.resolve(points.get(id)?.payload ?? null),
    ),
    upsert: vi.fn((batch: StoredPoint[]) => {
      for (const p of batch) points.set(p.id, { id: p.id, payload: p.payload });
      return Promise.resolve();
    }),
    delete: vi.fn((ids: string[]) => {
      for (const id of ids) points.delete(id);
      return Promise.resolve();
    }),
    setPayload: vi.fn((ids: string[], payload: Record<string, unknown>) => {
      for (const id of ids) {
        const p = points.get(id);
        if (p) p.payload = { ...p.payload, ...payload };
      }
      return Promise.resolve();
    }),
    deletePayload: vi.fn((ids: string[], keys: string[]) => {
      for (const id of ids) {
        const p = points.get(id);
        for (const key of keys) if (p) Reflect.deleteProperty(p.payload, key);
      }
      return Promise.resolve();
    }),
    scrollPage: vi.fn((filter?: unknown) => {
      const all = [...points.values()];
      const selected = isSourceDiscovery(filter)
        ? all.filter((p) => p.payload['chunk_index'] === 0 && p.payload.source)
        : all;
      return Promise.resolve({ points: selected, nextCursor: undefined });
    }),
  };
}

/** In-memory issues store (record replaces, like the processor expects). */
function memoryIssues() {
  const issues: Record<string, IssueRecord[]> = {};
  return {
    record: vi.fn(
      (
        key: string,
        type: IssueRecord['type'],
        message: string,
        options: Partial<IssueRecord> = {},
      ) => {
        issues[key] = [{ ...options, type, message, timestamp: 0 }];
      },
    ),
    clear: vi.fn((key: string) => {
      Reflect.deleteProperty(issues, key);
    }),
    get: (key: string) => issues[key],
    getAll: () => ({ ...issues }),
  };
}

/** Scripted callback responses keyed by reference (default: 404). */
export type Responses = Record<string, SourceRetrievalResult>;

/**
 * Callback body for a chat document.
 *
 * @param userId - User id.
 * @param text - Message text.
 * @returns A 200 JSON retrieval result.
 */
export const doc = (userId: string, text: string): SourceRetrievalResult => ({
  kind: 'document',
  body: { userId, text },
});

/**
 * Build the fixture.
 *
 * @param responses - Callback responses (mutable: change between runs).
 * @returns Deps for executeReindex plus handles on the store and mocks.
 */
export function sourceReindexFixture(responses: Responses) {
  const store = memoryVectorStore();
  const issues = memoryIssues();
  const retrieve = vi.fn((ref: string) =>
    Promise.resolve(responses[ref] ?? { kind: 'gone' as const }),
  );
  const retriever: SourceRetriever = {
    has: () => true,
    resolve: vi.fn(),
    retrieve,
  };
  const embed = vi.fn((texts: string[]) =>
    Promise.resolve(texts.map(() => [0.1])),
  );
  const logger = pino({ level: 'silent' });
  const processor = new DocumentProcessor({
    config: { chunkSize: 1000, chunkOverlap: 0 },
    embeddingProvider: { dimensions: 1, embed },
    vectorStore: store as unknown as VectorStoreClient,
    compiledRules: chatRules(),
    logger,
    issuesManager: issues as unknown as IssuesManager,
    sourceRetriever: retriever,
  });
  const sourceQueue = createNotifyQueue(
    processor,
    2,
    pino({ level: 'silent' }),
  );
  sourceQueue.start();
  const deps: ExecuteReindexDeps = {
    config: {
      watch: { paths: ['src/**'], ignored: [] },
      vectorStore: { url: 'http://localhost', collectionName: 't' },
      reindex: { concurrency: 4 },
    } as unknown as ExecuteReindexDeps['config'],
    processor,
    logger,
    issuesManager: issues,
    vectorStore: store as unknown as VectorStoreClient,
    sourceQueue,
    includeSources: true,
  };
  /** Index references through the processor (as notify would). */
  const index = async (...refs: string[]) => {
    for (const ref of refs)
      await processor.sourceOperations().process(ref, RULE);
    embed.mockClear();
    retrieve.mockClear();
    store.delete.mockClear();
    store.setPayload.mockClear();
  };
  return {
    deps,
    store,
    issues,
    retrieve,
    embed,
    processor,
    index,
    sourceQueue,
  };
}

/**
 * Seed a stored file point.
 *
 * @param store - The fixture store.
 * @param filePath - File path.
 */
export function seedFile(
  store: { points: Map<string, StoredPoint> },
  filePath: string,
): void {
  const id = pointId(filePath, 0);
  store.points.set(id, {
    id,
    payload: { file_path: filePath, chunk_index: 0, total_chunks: 1 },
  });
}
