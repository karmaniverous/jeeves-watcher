/**
 * @module api/handlers/documentsDelete.test
 * Fastify inject tests for POST /documents/delete: body validation, sources form, filter form constrained to source points (file points survive), enrichment/issue cleanup, deleted = documents.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScrolledPoint } from '../../vectorStore';
import { createDocumentsDeleteHandler } from './documentsDelete';

const logger = pino({ level: 'silent' });

/** A tiny in-memory "collection" that evaluates the filters this route builds. */
const points = new Map<string, Record<string, unknown>>();

function matches(
  payload: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  const must = (filter.must ?? []) as Record<string, unknown>[];
  const mustNot = (filter.must_not ?? []) as Record<string, unknown>[];
  const cond = (c: Record<string, unknown>): boolean => {
    if ('is_empty' in c) {
      const v = payload[(c.is_empty as { key: string }).key];
      return v === undefined || v === null || v === '';
    }
    if ('key' in c) {
      const v = payload[c.key as string];
      const m = c.match as { any?: unknown[]; value?: unknown };
      return m.any ? m.any.includes(v) : v === m.value;
    }
    return matches(payload, c);
  };
  return must.every(cond) && !mustNot.some(cond);
}

const vectorStore = {
  scrollPage: vi.fn((filter?: Record<string, unknown>) =>
    Promise.resolve({
      points: [...points]
        .filter(([, p]) => matches(p, filter ?? {}))
        .map(([id, payload]): ScrolledPoint => ({ id, payload })),
    }),
  ),
  delete: vi.fn((ids: string[]) => {
    for (const id of ids) points.delete(id);
    return Promise.resolve();
  }),
};
const enrichmentStore = { delete: vi.fn() };
const issuesManager = { clear: vi.fn() };

const app: FastifyInstance = Fastify({ logger: false });
app.post(
  '/documents/delete',
  createDocumentsDeleteHandler({
    vectorStore,
    enrichmentStore,
    issuesManager,
    logger,
  }),
);

beforeEach(() => {
  vi.clearAllMocks();
  points.clear();
  points.set('a0', { source: 'cg://a', user_id: 'u1' });
  points.set('a1', { source: 'cg://a', user_id: 'u1' });
  points.set('b0', { source: 'cg://b', user_id: 'u2' });
  points.set('f0', { file_path: 'j:/docs/a.md', user_id: 'u1' });
});

afterAll(async () => {
  await app.close();
});

async function post(payload: unknown) {
  const res = await app.inject({
    method: 'POST',
    url: '/documents/delete',
    payload: payload as object,
  });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

describe('POST /documents/delete', () => {
  it.each([
    ['an empty body', {}],
    ['both forms', { sources: ['cg://a'], filter: {} }],
    ['empty sources', { sources: [] }],
    ['a malformed reference', { sources: ['a.md'] }],
  ])('returns 400 for %s', async (_label, payload) => {
    const { status } = await post(payload);
    expect(status).toBe(400);
    expect(vectorStore.delete).not.toHaveBeenCalled();
  });

  it('deletes all chunks of the listed references and counts documents', async () => {
    const { status, body } = await post({ sources: ['cg://a', 'cg://zz'] });
    expect(status).toBe(200);
    expect(body).toEqual({ deleted: 1 });
    expect([...points.keys()]).toEqual(['b0', 'f0']);
    // Enrichment and issues are cleared for every listed reference.
    expect(enrichmentStore.delete.mock.calls).toEqual([
      ['cg://a'],
      ['cg://zz'],
    ]);
    expect(issuesManager.clear.mock.calls).toEqual([['cg://a'], ['cg://zz']]);
  });

  it('deletes by filter, constrained to points carrying source', async () => {
    const { body } = await post({
      filter: { must: [{ key: 'user_id', match: { value: 'u1' } }] },
    });
    expect(body).toEqual({ deleted: 1 });
    expect([...points.keys()]).toEqual(['b0', 'f0']);
    expect(enrichmentStore.delete).toHaveBeenCalledWith('cg://a');
  });

  it.each([
    ['an empty filter', {}],
    [
      'a file_path filter',
      { must: [{ key: 'file_path', match: { value: 'j:/docs/a.md' } }] },
    ],
  ])('can never delete file points (%s)', async (_label, filter) => {
    await post({ filter });
    expect(points.has('f0')).toBe(true);
    const sent = vectorStore.scrollPage.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      must_not: [{ is_empty: { key: 'source' } }],
    });
  });
});
