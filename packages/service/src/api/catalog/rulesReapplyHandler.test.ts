/**
 * @module api/catalog/rulesReapplyHandler.test
 * POST /rules/reapply over the catalog route: missing or malformed globs are the catalog's 400 invalid_request with nothing scrolled; a valid request answers reapplyRules' matched/updated counts.
 */

import Fastify from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { registerCatalogEntries } from '../../test/catalogRoutes';
import { createCatalogRulesReapplyHandler } from './rulesReapplyHandler';

/** POST the body over one page of points; return status, body and mocks. */
async function invoke(body: unknown) {
  const scrollPage = vi.fn().mockResolvedValue({
    points: [
      { id: '1', payload: { file_path: 'docs/a.md' } },
      { id: '2', payload: { file_path: 'docs/b.md' } },
      { id: '3', payload: { file_path: 'other/c.md' } },
    ],
  });
  const processRulesUpdate = vi.fn((path: string) =>
    Promise.resolve(path === 'docs/b.md' ? null : {}),
  );
  const app = Fastify({ logger: false });
  await registerCatalogEntries(app, {
    reapplyRules: createCatalogRulesReapplyHandler({
      vectorStore: { scrollPage } as never,
      processor: { processRulesUpdate } as never,
      logger: pino({ level: 'silent' }),
    }),
  });
  const res = await app.inject({
    method: 'POST',
    url: '/rules/reapply',
    ...(body === undefined ? {} : { payload: body as object }),
  });
  await app.close();
  return {
    status: res.statusCode,
    body: res.json<Record<string, unknown>>(),
    scrollPage,
    processRulesUpdate,
  };
}

describe('POST /rules/reapply', () => {
  it('answers matched and updated counts (a null update is not counted)', async () => {
    const res = await invoke({ globs: ['docs/**'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matched: 2, updated: 1 });
    expect(res.processRulesUpdate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no body', undefined],
    ['missing globs', {}],
    ['empty globs', { globs: [] }],
    ['an empty glob', { globs: [''] }],
    ['a non-array', { globs: 'docs/**' }],
  ])('rejects %s with 400 invalid_request', async (_label, body) => {
    const res = await invoke(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_request' });
    expect(res.scrollPage).not.toHaveBeenCalled();
  });
});
