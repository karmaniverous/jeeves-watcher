/**
 * @module test/countFacetsDeps
 * Test helpers for the `countFacets` handler: a rule factory, a fake facet store, handler dependencies and a request through the catalog route.
 */

import Fastify from 'fastify';
import pino from 'pino';
import { vi } from 'vitest';

import {
  type CatalogCountFacetsDeps,
  createCatalogCountFacetsHandler,
} from '../api/catalog/countFacetsHandler';
import type { InferenceRule } from '../config/types';
import type { FacetStore, SystemIndexState } from '../vectorStore';
import { registerCatalogEntries } from './catalogRoutes';
import { makeConfig } from './facetsDeps';

/** A rule with one schema of the given properties. */
export const rule = (name: string, properties: Record<string, unknown> = {}) =>
  ({
    name,
    description: name,
    match: {},
    schema: [{ properties }],
  }) as InferenceRule;

/**
 * A fake facet store: one count, ranges 1 to 9, `tag`/`size`/`at` indexed,
 * system indexes ready unless `states` says otherwise.
 */
export function fakeStore(
  overrides: Partial<FacetStore> = {},
  states: Record<string, SystemIndexState> = {
    chunk_index: 'ready',
    matched_rules: 'ready',
  },
) {
  return {
    facetCounts: vi.fn(() => Promise.resolve([{ value: 'x', count: 2 }])),
    rangeBound: vi.fn((_read, end: string) =>
      Promise.resolve(end === 'min' ? 1 : 9),
    ),
    payloadIndexTypes: vi.fn(() =>
      Promise.resolve({ tag: 'keyword', size: 'integer', at: 'datetime' }),
    ),
    systemIndexState: vi.fn((field: string) => states[field]),
    ...overrides,
  } satisfies FacetStore;
}

/** Handler dependencies: configured rule `a` (`size` hinted `number`), virtual rule `v`. */
export function deps(
  facetStore: FacetStore,
  extra: Partial<CatalogCountFacetsDeps> = {},
): CatalogCountFacetsDeps {
  return {
    getConfig: () =>
      makeConfig([rule('a', { size: { type: 'integer', uiHint: 'number' } })]),
    getVirtualRules: () => ({ plugin: [rule('v')] }),
    configDir: '/tmp',
    facetStore,
    logger: pino({ level: 'silent' }),
    ...extra,
  };
}

/** POST a body to `/search/facets/counts` through the catalog route. */
export async function post(d: CatalogCountFacetsDeps, body: unknown) {
  const app = Fastify();
  await registerCatalogEntries(app, {
    countFacets: createCatalogCountFacetsHandler(d),
  });
  const res = await app.inject({
    method: 'POST',
    url: '/search/facets/counts',
    payload: body as Record<string, unknown>,
  });
  await app.close();
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}
