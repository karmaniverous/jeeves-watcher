/**
 * @module api/routeAuth.test
 * With `api.apiKey` set, every route `createApiServer` actually registers (enumerated from `printRoutes`, all optional route groups enabled) answers 401 without a valid bearer token, except `GET`/`HEAD /status`.
 */

import { WATCHER_ENDPOINTS } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { VirtualRuleStore } from '../rules/virtualRules';
import type { ApiServerOptions } from './apiServerOptions';
import { createApiServer } from './index';

const API_KEY = 'route-auth-test-key';

const config = {
  watch: { paths: ['**/*.md'], ignored: [] },
  embedding: { provider: 'mock', model: 'test', dimensions: 3 },
  vectorStore: { url: 'http://127.0.0.1:9', collectionName: 'test' },
  api: { apiKey: API_KEY, cacheTtlMs: 0 },
} as unknown as JeevesWatcherConfig;

/** Stub collaborators: auth rejects before any handler runs. */
const options = {
  config,
  configPath: '/tmp/jeeves-watcher-route-auth/config.json',
  processor: {},
  vectorStore: {
    getCollectionInfo: () =>
      Promise.resolve({ pointCount: 0, dimensions: 3, payloadFields: {} }),
  },
  embeddingProvider: {},
  logger: pino({ level: 'silent' }),
  descriptor: {},
  issuesManager: {},
  valuesManager: {},
  virtualRuleStore: new VirtualRuleStore(),
  vcsCoordinator: {},
} as unknown as ApiServerOptions;

/** One registered method + path. */
interface RegisteredRoute {
  method: string;
  path: string;
}

/**
 * Flatten Fastify's `printRoutes({ commonPrefix: false })` tree, e.g.
 * `├── /search (POST)` / `│   └── /facets (GET, HEAD)`, into full paths.
 */
function parseRoutes(tree: string): RegisteredRoute[] {
  const stack: string[] = [];
  const routes: RegisteredRoute[] = [];
  for (const line of tree.split('\n')) {
    const match = /^(.*?)[├└]── (\S+)(?: \(([^)]+)\))?$/u.exec(line);
    if (!match) continue;
    const [, indent, segment, methods] = match;
    const depth = indent.length / 4;
    stack.length = depth;
    const path = `${stack.join('')}${segment}`;
    stack.push(segment);
    for (const method of methods ? methods.split(', ') : []) {
      routes.push({ method, path });
    }
  }
  return routes;
}

/** A concrete URL for a route path (fills `:param` segments). */
const concrete = (path: string) => path.replace(/:[^/]+/g, 'x');

const isStatus = ({ method, path }: RegisteredRoute) =>
  path === '/status' && (method === 'GET' || method === 'HEAD');

let app: FastifyInstance;
let routes: RegisteredRoute[];

beforeAll(async () => {
  app = createApiServer(options);
  await app.ready();
  routes = parseRoutes(app.printRoutes({ commonPrefix: false }));
});

afterAll(async () => {
  await app.close();
});

describe('api.apiKey covers every registered route', () => {
  it('enumerates every catalogued endpoint from the live server', () => {
    const keys = new Set(routes.map((r) => `${r.method} ${r.path}`));
    for (const endpoint of WATCHER_ENDPOINTS) {
      expect(keys).toContain(`${endpoint.method} ${endpoint.path}`);
    }
  });

  it('returns 401 without a token on every route except GET/HEAD /status', async () => {
    const guarded = routes.filter((r) => !isStatus(r));
    expect(guarded.length).toBeGreaterThanOrEqual(WATCHER_ENDPOINTS.length - 1);
    for (const route of guarded) {
      const res = await app.inject({
        method: route.method as 'GET',
        url: concrete(route.path),
      });
      expect([route, res.statusCode]).toEqual([route, 401]);
      // HEAD responses carry no body.
      const body = route.method === 'HEAD' ? undefined : res.json<unknown>();
      expect([route, body]).toEqual([
        route,
        route.method === 'HEAD'
          ? undefined
          : { code: 'unauthorized', error: 'Unauthorized' },
      ]);
    }
  });

  it('returns 401 with a wrong token on every route except GET/HEAD /status', async () => {
    for (const route of routes.filter((r) => !isStatus(r))) {
      const res = await app.inject({
        method: route.method as 'GET',
        url: concrete(route.path),
        headers: { authorization: 'Bearer not-the-key' },
      });
      expect([route, res.statusCode]).toEqual([route, 401]);
    }
  });

  it('leaves GET and HEAD /status open', async () => {
    const status = routes.filter(isStatus).map((r) => r.method);
    expect(status.sort()).toEqual(['GET', 'HEAD']);
    for (const method of ['GET', 'HEAD'] as const) {
      const res = await app.inject({ method, url: '/status' });
      expect(res.statusCode).toBe(200);
    }
  });
});
