/**
 * @module processor/SourceOperations.test
 * DocumentProcessor.sourceOperations(): notify validation codes, stored designated rule, render outcomes (no writes, no issues; unexpected errors rethrown), metadata enrichment with system fields re-asserted. Processing: processSource*.test.ts and SourceOperations.force.test.ts.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { InferenceRule } from '../config/types';
import type { IssuesManager } from '../issues';
import { sourcePointId } from '../pointId';
import { compileRules } from '../rules';
import {
  SourceClient,
  type SourceRetrievalResult,
  type SourceRetriever,
} from '../sources';
import { buildTemplateEngine } from '../templates';
import type { VectorStoreClient } from '../vectorStore';
import { DocumentProcessor } from './index';
import { hasSourceOperations } from './SourceOperations';

const REF = 'app://chat/thread/1';

const rules: InferenceRule[] = [
  {
    name: 'chat',
    description: 'Chat',
    match: { type: 'object', required: ['source', 'json'] },
    schema: [
      {
        type: 'object',
        properties: { user_id: { type: 'string', set: '{{json.userId}}' } },
      },
    ],
    template: '{{#each msgs}}- {{this}}\n{{/each}}',
  },
  {
    name: 'strict',
    description: 'Requires json.other',
    match: {
      type: 'object',
      properties: {
        json: { type: 'object', required: ['other'] },
      },
      required: ['json'],
    },
  },
];

const templateEngine = await buildTemplateEngine(rules);

function setup(
  options: {
    result?: SourceRetrievalResult;
    stored?: Record<string, unknown> | null;
    retriever?: SourceRetriever | null;
  } = {},
) {
  const vectorStore = {
    getPayload: vi.fn().mockResolvedValue(options.stored ?? null),
    setPayload: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const retrieve = vi.fn().mockResolvedValue(
    options.result ?? {
      kind: 'document',
      body: { userId: 'u1', msgs: ['hi', 'there'] },
    },
  );
  const client = new SourceClient({
    app: { url: 'http://cb.local/{id}', timeoutMs: 1000, concurrency: 1 },
  });
  const retriever =
    options.retriever === null
      ? undefined
      : (options.retriever ?? {
          resolve: (ref: string) => client.resolve(ref),
          retrieve,
        });
  const enrichment = new Map<string, Record<string, unknown>>();
  const enrichmentStore = {
    get: vi.fn((k: string) => enrichment.get(k) ?? null),
    set: vi.fn((k: string, m: Record<string, unknown>) => {
      enrichment.set(k, { ...enrichment.get(k), ...m });
    }),
    delete: vi.fn(),
    move: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  };
  const issues = { record: vi.fn(), clear: vi.fn(), get: vi.fn() };
  const processor = new DocumentProcessor({
    config: { chunkSize: 1000, chunkOverlap: 0 },
    embeddingProvider: {
      dimensions: 1,
      embed: (texts: string[]) => Promise.resolve(texts.map(() => [0.1])),
    },
    vectorStore: vectorStore as unknown as VectorStoreClient,
    compiledRules: compileRules(rules),
    logger: pino({ level: 'silent' }),
    templateEngine,
    enrichmentStore,
    issuesManager: issues as unknown as IssuesManager,
    sourceRetriever: retriever,
  });
  return {
    ops: processor.sourceOperations(),
    processor,
    vectorStore,
    retrieve,
    issues,
    enrichmentStore,
  };
}

/** Asymmetric matcher typed as unknown (no unsafe any in literals). */
const anyArray: unknown = expect.any(Array);

describe('hasSourceOperations', () => {
  it('detects processors exposing sourceOperations()', () => {
    expect(hasSourceOperations(setup().processor)).toBe(true);
    expect(hasSourceOperations({})).toBe(false);
  });
});

describe('SourceOperations.validate', () => {
  it.each([
    ['a valid notification', REF, 'chat', undefined],
    ['a malformed reference', 'app:1', 'chat', 'invalid_reference'],
    ['an unconfigured source', 'zz://chat/1', 'chat', 'unknown_source'],
    ['an unsafe id', 'app://chat/../x', 'chat', 'invalid_id'],
    ['an unknown rule', REF, 'nope', 'rule_missing'],
  ])('%s', (_label, ref, rule, code) => {
    const error = setup().ops.validate(ref, rule);
    expect(error?.code).toBe(code);
  });

  it('reports unknown_source when no sources are configured', () => {
    expect(setup({ retriever: null }).ops.validate(REF, 'chat')).toEqual({
      code: 'unknown_source',
      message: 'No sources are configured',
    });
  });

  it('rethrows unexpected errors', () => {
    const retriever: SourceRetriever = {
      resolve: () => {
        throw new Error('boom');
      },
      retrieve: vi.fn(),
    };
    expect(() => setup({ retriever }).ops.validate(REF, 'chat')).toThrow(
      'boom',
    );
  });
});

describe('SourceOperations.storedRule', () => {
  it('reads source_rule from the chunk-0 point', async () => {
    const { ops, vectorStore } = setup({ stored: { source_rule: 'chat' } });
    await expect(ops.storedRule(REF)).resolves.toBe('chat');
    expect(vectorStore.getPayload).toHaveBeenCalledWith(sourcePointId(REF, 0));
  });

  it.each([[null], [{}], [{ source_rule: '' }]])(
    'returns null for %j',
    async (stored) => {
      await expect(setup({ stored }).ops.storedRule(REF)).resolves.toBeNull();
    },
  );
});

describe('SourceOperations.render', () => {
  it('renders through the designated rule without writing', async () => {
    const { ops, vectorStore, issues } = setup();
    const outcome = await ops.render(REF, 'chat');
    expect(outcome).toEqual({
      kind: 'rendered',
      result: {
        renderAs: 'md',
        content: '- hi\n- there\n',
        rules: ['chat'],
        metadata: { user_id: 'u1', matched_rules: ['chat'] },
        transformed: true,
      },
    });
    expect(vectorStore.upsert).not.toHaveBeenCalled();
    expect(vectorStore.setPayload).not.toHaveBeenCalled();
    expect(issues.record).not.toHaveBeenCalled();
  });

  it('passes JSON through when the rule has no template', async () => {
    const { ops } = setup({
      result: { kind: 'document', body: { other: 'value' } },
    });
    const outcome = await ops.render(REF, 'strict');
    expect(outcome).toMatchObject({
      kind: 'rendered',
      result: { renderAs: 'json', transformed: false },
    });
  });

  it('returns gone on a 404', async () => {
    const { ops } = setup({ result: { kind: 'gone' } });
    await expect(ops.render(REF, 'chat')).resolves.toEqual({ kind: 'gone' });
  });

  it('returns pipeline failures with their code, unrecorded', async () => {
    const { ops, issues } = setup();
    const outcome = await ops.render(REF, 'strict');
    expect(outcome).toMatchObject({
      kind: 'failed',
      error: { code: 'match_failed', details: anyArray },
    });
    await expect(ops.render(REF, 'nope')).resolves.toMatchObject({
      kind: 'failed',
      error: { code: 'rule_missing' },
    });
    expect(issues.record).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected (untagged) error instead of returning it', async () => {
    const { ops, enrichmentStore } = setup();
    enrichmentStore.get.mockImplementation(() => {
      throw new Error('store closed');
    });
    await expect(ops.render(REF, 'chat')).rejects.toThrow('store closed');
  });

  it('tags a rejected retrieval as source_unavailable', async () => {
    const { ops, retrieve } = setup();
    retrieve.mockRejectedValue(new Error('socket'));
    await expect(ops.render(REF, 'chat')).resolves.toMatchObject({
      kind: 'failed',
      error: { code: 'source_unavailable' },
    });
  });
});

describe('SourceOperations.updateMetadata', () => {
  it('merges enrichment into every chunk, re-asserting system fields', async () => {
    const { ops, vectorStore, enrichmentStore } = setup({
      stored: { source: REF, source_rule: 'chat', total_chunks: 2 },
    });
    const merged = await ops.updateMetadata(REF, {
      priority: 1,
      source: 'evil',
      file_path: 'evil',
    });
    expect(merged).toMatchObject({ priority: 1 });
    expect(enrichmentStore.set).toHaveBeenCalledWith(REF, expect.any(Object));
    expect(vectorStore.setPayload).toHaveBeenCalledWith(
      [sourcePointId(REF, 0), sourcePointId(REF, 1)],
      { priority: 1, source: REF, source_rule: 'chat' },
    );
  });

  it('stores nothing for a document that is not indexed', async () => {
    const { ops, vectorStore, enrichmentStore } = setup();
    await expect(ops.updateMetadata(REF, { a: 1 })).resolves.toBeNull();
    expect(enrichmentStore.set).not.toHaveBeenCalled();
    expect(vectorStore.setPayload).not.toHaveBeenCalled();
  });
});
