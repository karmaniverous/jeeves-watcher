/**
 * @module api/registerRoutes.test
 * The route-group registrars (registerDocumentRoutes, registerConfigRoutes, registerRuleRoutes) register their endpoints on a Fastify instance and wire their handlers' dependencies (smoke requests that need no Qdrant).
 */

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';
import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { VirtualRuleStore } from '../rules/virtualRules';
import type { ApiServerOptions } from './apiServerOptions';
import { registerConfigRoutes } from './registerConfigRoutes';
import { registerDocumentRoutes } from './registerDocumentRoutes';
import { registerRuleRoutes } from './registerRuleRoutes';
import { ReindexTracker } from './ReindexTracker';

const config = {
  watch: { paths: ['**/*.md'], ignored: [] },
  embedding: { provider: 'mock', model: 'test', dimensions: 3 },
  vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
} as unknown as JeevesWatcherConfig;

/** Server options over stubs: no source support, no queues. */
const options = {
  config,
  configPath: '/tmp/jeeves-watcher-test/config.json',
  processor: {},
  vectorStore: {},
  embeddingProvider: {},
  logger: pino({ level: 'silent' }),
  descriptor: {},
} as unknown as ApiServerOptions;

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

/** The route of an endpoint, as registered. */
const route = (name: Parameters<typeof getEndpoint>[0]) => {
  const { method, path } = getEndpoint(name);
  return { method, url: path };
};

describe('registerDocumentRoutes', () => {
  it('registers /documents and /documents/delete', async () => {
    app = Fastify();
    registerDocumentRoutes(app, options);
    await app.ready();
    expect(app.hasRoute(route('documents'))).toBe(true);
    expect(app.hasRoute(route('documentsDelete'))).toBe(true);
    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: { documents: [{ source: 'app://1', rule: 'r' }] },
    });
    expect(res.statusCode).toBe(503);
  });
});

describe('registerConfigRoutes', () => {
  it('registers the legacy config and reindex routes, not the catalog ones', async () => {
    app = Fastify();
    registerConfigRoutes(app, options, {
      getConfig: () => config,
      reindexTracker: new ReindexTracker(),
      cacheTtlMs: 0,
    });
    await app.ready();
    for (const name of [
      'reindex',
      'configSchema',
      'configMatch',
      'configValidate',
    ] as const) {
      expect(app.hasRoute(route(name))).toBe(true);
    }
    for (const name of ['config', 'configApply'] as const) {
      expect(app.hasRoute(route(name))).toBe(false);
    }
    const res = await app.inject({
      method: 'POST',
      url: '/reindex',
      payload: { scope: 'path', source: 'app://1' },
    });
    expect(res.statusCode).toBe(503);
  });
});

describe('registerRuleRoutes', () => {
  it('registers the virtual-rule and points routes', async () => {
    app = Fastify();
    const virtualRuleStore = new VirtualRuleStore();
    registerRuleRoutes(app, options, {
      virtualRuleStore,
      getConfig: () => config,
      reindexTracker: new ReindexTracker(),
    });
    await app.ready();
    for (const name of [
      'rulesRegister',
      'rulesUnregister',
      'rulesUnregisterBySource',
      'pointsDelete',
      'rulesReapply',
    ] as const) {
      expect(app.hasRoute(route(name))).toBe(true);
    }
    const res = await app.inject({
      method: 'POST',
      url: '/rules/register',
      payload: { rules: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(virtualRuleStore.size).toBe(0);
  });
});
