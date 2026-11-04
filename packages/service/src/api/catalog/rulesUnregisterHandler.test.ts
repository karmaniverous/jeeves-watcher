/**
 * @module api/catalog/rulesUnregisterHandler.test
 * DELETE /rules/unregister (body) and /rules/unregister/:source (param) over the catalog routes: removal answers `removed: true` and fires onRulesChanged once; an unknown source answers `removed: false` without firing it; a missing or empty body source is the catalog's 400 invalid_request.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VirtualRuleStore } from '../../rules/virtualRules';
import { registerCatalogEntries } from '../../test/catalogRoutes';
import {
  createCatalogRulesUnregisterBySourceHandler,
  createCatalogRulesUnregisterHandler,
} from './rulesUnregisterHandler';

let store: VirtualRuleStore;
let onRulesChanged: ReturnType<typeof vi.fn<() => void>>;
let app: FastifyInstance;

beforeEach(async () => {
  store = new VirtualRuleStore();
  store.register('my-plugin', [
    { name: 'r1', description: 'A rule', match: { type: 'object' } },
  ]);
  onRulesChanged = vi.fn<() => void>();
  const deps = {
    virtualRuleStore: store,
    logger: pino({ level: 'silent' }),
    onRulesChanged,
  };
  app = Fastify({ logger: false });
  await registerCatalogEntries(app, {
    unregisterRules: createCatalogRulesUnregisterHandler(deps),
    unregisterRulesBySource: createCatalogRulesUnregisterBySourceHandler(deps),
  });
});

afterEach(async () => {
  await app.close();
});

const variants = [
  [
    'body',
    (source: string) =>
      app.inject({
        method: 'DELETE',
        url: '/rules/unregister',
        payload: { source },
      }),
  ],
  [
    'param',
    (source: string) =>
      app.inject({
        method: 'DELETE',
        url: `/rules/unregister/${encodeURIComponent(source)}`,
      }),
  ],
] as const;

describe.each(variants)('rules unregister (%s)', (_label, unregister) => {
  it('removes the source and fires onRulesChanged once', async () => {
    const res = await unregister('my-plugin');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ source: 'my-plugin', removed: true });
    expect(store.size).toBe(0);
    expect(onRulesChanged).toHaveBeenCalledOnce();
  });

  it('answers removed: false for an unknown source without firing', async () => {
    const res = await unregister('other');
    expect(res.json()).toEqual({ source: 'other', removed: false });
    expect(store.size).toBe(1);
    expect(onRulesChanged).not.toHaveBeenCalled();
  });
});

describe('rules unregister (body) validation', () => {
  it.each([[{}], [{ source: '' }]])(
    'rejects %j with 400 invalid_request',
    async (payload) => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/rules/unregister',
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'invalid_request' });
      expect(store.size).toBe(1);
      expect(onRulesChanged).not.toHaveBeenCalled();
    },
  );
});
