/**
 * @module api/apiServerRoutes.test
 * `createApiServer` registers every `WATCHER_CATALOG` route from the catalog, with or without a VCS coordinator (the `/vcs/*` routes are always registered; the feature gate answers them while VCS is off), and wires the handlers' dependencies (smoke requests that need no Qdrant).
 */

import { WATCHER_CATALOG } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { VirtualRuleStore } from '../rules/virtualRules';
import type { ApiServerOptions } from './apiServerOptions';
import type { WatcherEntryName } from './catalog/catalogEntry';
import { createApiServer } from './index';

const config = {
  watch: { paths: ['**/*.md'], ignored: [] },
  embedding: { provider: 'mock', model: 'test', dimensions: 3 },
  vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
  api: { cacheTtlMs: 0 },
} as unknown as JeevesWatcherConfig;

/** Server options over stubs: no source support, no queues, no VCS. */
const options = (virtualRuleStore = new VirtualRuleStore()) =>
  ({
    config,
    configPath: '/tmp/jeeves-watcher-test/config.json',
    processor: {},
    vectorStore: {},
    embeddingProvider: {},
    logger: pino({ level: 'silent' }),
    descriptor: {},
    issuesManager: {},
    valuesManager: {},
    virtualRuleStore,
  }) as unknown as ApiServerOptions;

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

/** The route of an endpoint, as registered. */
const route = (name: WatcherEntryName) => {
  const { method, path } = WATCHER_CATALOG.byName(name);
  return { method, url: path };
};

describe('createApiServer routes', () => {
  it.each([
    ['without VCS', {}],
    ['with VCS', { vcsCoordinator: { getRoots: () => [] } }],
  ])('registers every catalog route %s', async (_label, extra) => {
    app = createApiServer({ ...options(), ...extra } as ApiServerOptions);
    await app.ready();

    const missing = WATCHER_CATALOG.entries
      .map(({ name }) => name)
      .filter((name) => !app.hasRoute(route(name)));
    expect(missing).toEqual([]);
  });

  it('wires source support into documents and reindex (503 without it)', async () => {
    app = createApiServer(options());

    const documents = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: { documents: [{ source: 'app://1', rule: 'r' }] },
    });
    const reindex = await app.inject({
      method: 'POST',
      url: '/reindex',
      payload: { scope: 'path', source: 'app://1' },
    });

    expect(documents.statusCode).toBe(503);
    expect(reindex.statusCode).toBe(503);
  });

  it('wires the virtual rule store into the rule routes', async () => {
    const virtualRuleStore = new VirtualRuleStore();
    virtualRuleStore.register('plug', [
      { name: 'r1', description: 'A rule', match: { type: 'object' } },
    ]);
    app = createApiServer(options(virtualRuleStore));

    const res = await app.inject({
      method: 'DELETE',
      url: '/rules/unregister/other',
    });

    expect(res.json()).toEqual({ source: 'other', removed: false });
    expect(virtualRuleStore.size).toBe(1);
  });
});
