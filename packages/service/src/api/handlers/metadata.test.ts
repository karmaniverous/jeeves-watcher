/**
 * @module api/handlers/metadata.test
 * POST /metadata through a real Fastify route: file paths validate against matched rules; source references need a stored point (404 source_not_indexed; a failed read is 500, not 404), validate against the designated rule resolved by the processor's own lookup (config or virtual rule); 503 without source support.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InferenceRule, JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessorInterface } from '../../processor';
import { compileRules } from '../../rules/compile';
import { createMetadataHandler } from './metadata';

const REF = 'app://chat/1';

/** A rule declaring `priority: integer`. */
const typedRule = (name: string): InferenceRule => ({
  name,
  description: name,
  match: { type: 'object' },
  schema: [{ type: 'object', properties: { priority: { type: 'integer' } } }],
});

const config = {
  watch: { paths: ['**/*.md'], ignored: [] },
  inferenceRules: [typedRule('docs')],
} as unknown as JeevesWatcherConfig;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Build the route over a processor stub. */
function build(options: {
  storedRule?: string | null;
  sources?: boolean;
  virtual?: InferenceRule[];
}) {
  // The processor's own lookup over the merged rule set (config, then virtual).
  const compiled = compileRules([
    ...(config.inferenceRules ?? []),
    ...(options.virtual ?? []),
  ]);
  const ops = {
    storedRule: vi.fn(() => Promise.resolve(options.storedRule ?? null)),
    compiledRule: (name: string) => compiled.find((c) => c.rule.name === name),
    updateMetadata: vi.fn(() => Promise.resolve({})),
  };
  const processMetadataUpdate = vi.fn(() => Promise.resolve(null));
  const processor = {
    processMetadataUpdate,
    ...(options.sources === false ? {} : { sourceOperations: () => ops }),
  } as unknown as DocumentProcessorInterface;
  const server = Fastify();
  app = server;
  server.post(
    '/metadata',
    createMetadataHandler({
      processor,
      getConfig: () => config,
      logger: pino({ level: 'silent' }),
    }),
  );
  return { processMetadataUpdate, ops };
}

const post = async (payload: object) => {
  if (!app) throw new Error('build() first');
  const res = await app.inject({ method: 'POST', url: '/metadata', payload });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
};

describe('POST /metadata', () => {
  it('updates a file path', async () => {
    const { processMetadataUpdate } = build({});
    const res = await post({ path: 'a.md', metadata: { priority: 1 } });
    expect(res).toEqual({
      status: 200,
      body: { ok: true, matched_rules: ['docs'] },
    });
    expect(processMetadataUpdate).toHaveBeenCalledWith('a.md', {
      priority: 1,
    });
  });

  it('rejects a file metadata type mismatch with 400', async () => {
    build({});
    const res = await post({ path: 'a.md', metadata: { priority: 'high' } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_request' });
  });

  it('answers 404 source_not_indexed for an unindexed reference', async () => {
    const { ops } = build({ storedRule: null });
    const res = await post({ source: REF, metadata: { priority: 1 } });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'source_not_indexed' });
    expect(ops.updateMetadata).not.toHaveBeenCalled();
  });

  it('answers 500, not 404, when the stored-point read fails', async () => {
    const { ops } = build({ storedRule: 'docs' });
    ops.storedRule.mockRejectedValueOnce(new Error('qdrant down'));
    const res = await post({ source: REF, metadata: { priority: 1 } });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 'internal_error' });
    expect(ops.updateMetadata).not.toHaveBeenCalled();
  });

  it('validates a source against its config designated rule', async () => {
    const { ops } = build({ storedRule: 'docs' });
    const bad = await post({ source: REF, metadata: { priority: 'x' } });
    expect(bad.status).toBe(400);
    const ok = await post({ source: REF, metadata: { priority: 2 } });
    expect(ok.body).toEqual({ ok: true, matched_rules: ['docs'] });
    expect(ops.updateMetadata).toHaveBeenCalledTimes(1);
  });

  it('validates a source against a virtual designated rule', async () => {
    const { ops } = build({
      storedRule: 'plugin-chat',
      virtual: [typedRule('plugin-chat')],
    });
    const bad = await post({ source: REF, metadata: { priority: 'x' } });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({
      code: 'invalid_request',
      details: [expect.objectContaining({ rule: 'plugin-chat' })],
    });
    const ok = await post({ source: REF, metadata: { priority: 3 } });
    expect(ok.body).toEqual({ ok: true, matched_rules: ['plugin-chat'] });
    expect(ops.updateMetadata).toHaveBeenCalledTimes(1);
  });

  it('accepts anything when the designated rule no longer exists', async () => {
    build({ storedRule: 'gone' });
    const res = await post({ source: REF, metadata: { priority: 'x' } });
    expect(res.body).toEqual({ ok: true, matched_rules: [] });
  });

  it('answers 503 not_available without source support', async () => {
    build({ sources: false });
    const res = await post({ source: REF, metadata: {} });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'not_available' });
  });
});
