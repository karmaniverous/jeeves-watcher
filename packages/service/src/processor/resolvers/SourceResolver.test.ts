/**
 * @module processor/resolvers/SourceResolver.test
 * SourceResolver outcomes: document (rendered / JSON), gone, callback errors, match_failed, rule_missing, no_content.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { InferenceRule } from '../../config/types';
import { compileRules } from '../../rules';
import type { SourceRetrievalResult, SourceRetriever } from '../../sources';
import { createHandlebarsInstance, TemplateEngine } from '../../templates';
import { ProcessingFailure } from '../issueRecording';
import { SourceResolver } from './SourceResolver';

const REF = 'app://chat/thread/AbC';
const NOW = new Date('2026-10-12T00:00:00.000Z');

const rules: InferenceRule[] = [
  {
    name: 'streak',
    description: 'Chat streak',
    match: {
      type: 'object',
      required: ['source', 'json'],
      properties: {
        json: { type: 'object', required: ['userId'] },
      },
    },
    schema: [
      {
        type: 'object',
        properties: {
          user_id: { type: 'string', set: '{{json.userId}}' },
          ref: { type: 'string', set: '{{source.ref}}' },
        },
      },
    ],
    template: 'streak',
  },
  {
    name: 'plain',
    description: 'Plain JSON',
    match: { type: 'object', required: ['source'] },
  },
];

function makeRetriever(result: SourceRetrievalResult | Error) {
  const retrieve = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  const retriever: SourceRetriever = {
    has: () => true,
    resolve: vi.fn(),
    retrieve,
  };
  return { retriever, retrieve };
}

function makeResolver(retriever?: SourceRetriever) {
  const templateEngine = new TemplateEngine(createHandlebarsInstance());
  templateEngine.compile('streak', '# Thread {{userId}}\n\n{{text}}');
  return new SourceResolver({
    compiledRules: compileRules(rules),
    config: {},
    logger: pino({ level: 'silent' }),
    templateEngine,
    retriever,
    now: () => NOW,
  });
}

async function expectFailure(promise: Promise<unknown>, issueType: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProcessingFailure);
  expect((error as ProcessingFailure).issueType).toBe(issueType);
  return error as ProcessingFailure;
}

describe('SourceResolver', () => {
  it('resolves a rendered document with source attributes and metadata', async () => {
    const { retriever, retrieve } = makeRetriever({
      kind: 'document',
      body: { userId: 'u1', text: 'hello' },
    });
    const outcome = await makeResolver(retriever).resolve({
      ref: REF,
      rule: 'streak',
    });

    expect(retrieve).toHaveBeenCalledWith(REF);
    expect(outcome.kind).toBe('document');
    if (outcome.kind !== 'document') return;
    const doc = outcome.document;
    expect(doc.identity).toEqual({ kind: 'source', ref: REF, rule: 'streak' });
    expect(doc.text).toBe('# Thread u1\n\nhello');
    expect(doc.splitterExt).toBe('.md');
    expect(doc.matchedRules).toEqual(['streak']);
    expect(doc.metadata).toEqual({ user_id: 'u1', ref: REF });
    expect(doc.metadataWithRules).toEqual({
      user_id: 'u1',
      ref: REF,
      matched_rules: ['streak'],
    });
    expect(doc.refreshMetadataWhenUnchanged).toBe(true);
  });

  it('embeds JSON as a JSON file would be when the rule has no template', async () => {
    const body = { a: 1, b: [2, 3] };
    const { retriever } = makeRetriever({ kind: 'document', body });
    const outcome = await makeResolver(retriever).resolve({
      ref: REF,
      rule: 'plain',
    });
    if (outcome.kind !== 'document') throw new Error('expected document');
    expect(outcome.document.text).toBe(JSON.stringify(body));
    expect(outcome.document.splitterExt).toBe('.json');
  });

  it('keeps created_at from chunk 0 and stamps modified_at now', async () => {
    const { retriever } = makeRetriever({ kind: 'document', body: { a: 1 } });
    const outcome = await makeResolver(retriever).resolve({
      ref: REF,
      rule: 'plain',
    });
    if (outcome.kind !== 'document') throw new Error('expected document');
    const now = Math.floor(NOW.getTime() / 1000);
    await expect(outcome.document.dates({ created_at: 123 })).resolves.toEqual({
      createdAt: 123,
      modifiedAt: now,
    });
    await expect(outcome.document.dates(null)).resolves.toEqual({
      createdAt: now,
      modifiedAt: now,
    });
  });

  it('reports gone on 404', async () => {
    const { retriever } = makeRetriever({ kind: 'gone' });
    await expect(
      makeResolver(retriever).resolve({ ref: REF, rule: 'plain' }),
    ).resolves.toEqual({ kind: 'gone' });
  });

  it.each(['source_unavailable', 'unsupported_content_type'] as const)(
    'throws %s for a callback error',
    async (code) => {
      const { retriever } = makeRetriever({
        kind: 'error',
        code,
        message: 'boom',
      });
      const failure = await expectFailure(
        makeResolver(retriever).resolve({ ref: REF, rule: 'plain' }),
        code,
      );
      expect(failure.message).toBe('boom');
    },
  );

  it('maps a rejected reference to source_unavailable', async () => {
    const { retriever } = makeRetriever(new Error('unknown source'));
    await expect(
      makeResolver(retriever).resolve({ ref: REF, rule: 'plain' }),
    ).rejects.toMatchObject({
      issueType: 'source_unavailable',
    });
  });

  it('fails source_unavailable when no sources are configured', async () => {
    await expect(
      makeResolver().resolve({ ref: REF, rule: 'plain' }),
    ).rejects.toMatchObject({
      issueType: 'source_unavailable',
    });
  });

  it('throws match_failed with AJV errors when the designated rule does not match', async () => {
    const { retriever } = makeRetriever({
      kind: 'document',
      body: { text: 'no user' },
    });
    const failure = await expectFailure(
      makeResolver(retriever).resolve({ ref: REF, rule: 'streak' }),
      'match_failed',
    );
    expect(failure.message).toContain('userId');
    expect(failure.details).toEqual([
      expect.objectContaining({ instancePath: '/json', keyword: 'required' }),
    ]);
  });

  it('throws rule_missing without retrieving', async () => {
    const { retriever, retrieve } = makeRetriever({ kind: 'gone' });
    await expectFailure(
      makeResolver(retriever).resolve({ ref: REF, rule: 'nope' }),
      'rule_missing',
    );
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('throws no_content for an empty body', async () => {
    const { retriever } = makeRetriever({ kind: 'document', body: {} });
    await expect(
      makeResolver(retriever).resolve({ ref: REF, rule: 'plain' }),
    ).rejects.toMatchObject({
      issueType: 'no_content',
    });
  });

  it('never matches a file rule (no file key)', async () => {
    const fileRules = compileRules([
      {
        name: 'files',
        description: 'Files',
        match: { type: 'object', required: ['file'] },
      },
    ]);
    const { retriever } = makeRetriever({ kind: 'document', body: { a: 1 } });
    const resolver = new SourceResolver({
      compiledRules: fileRules,
      config: {},
      logger: pino({ level: 'silent' }),
      retriever,
    });
    await expect(
      resolver.resolve({ ref: REF, rule: 'files' }),
    ).rejects.toMatchObject({
      issueType: 'match_failed',
    });
  });
});
