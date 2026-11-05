/**
 * @module api/catalog/facetsHandler.rules.test
 * `GET /search/facets?rules=` (spec Design 12, A8): only the fields the named rules declare, only the values recorded for their documents, virtual rule names accepted, unknown names `400`; without `rules`, configured rules only (0.20.0).
 */

import Fastify from 'fastify';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import type { InferenceRule } from '../../config/types';
import { registerCatalogEntries } from '../../test/catalogRoutes';
import { makeConfig, makeDeps, makeValuesManager } from '../../test/facetsDeps';
import {
  createCatalogFacetsHandler,
  createFacetsLister,
} from './facetsHandler';

const rule = (
  name: string,
  properties: Record<string, unknown>,
): InferenceRule =>
  ({
    name,
    description: name,
    match: {},
    schema: [{ properties }],
  }) as InferenceRule;

const tag = { type: 'string', uiHint: 'tags' };

/** Rules a and b share `tag`; a also has `alpha`, b `beta`; v is virtual. */
const deps = makeDeps({
  getConfig: () =>
    makeConfig([
      rule('a', { tag, alpha: { type: 'string', uiHint: 'dropdown' } }),
      rule('b', { tag, beta: { type: 'string', enum: ['p', 'q'] } }),
    ]),
  getVirtualRules: () => ({
    plugin: [rule('v', { tag, gamma: { type: 'number', uiHint: 'number' } })],
  }),
  valuesManager: makeValuesManager({
    a: { tag: ['x', 'y'], alpha: ['1'] },
    b: { tag: ['z'] },
    v: { tag: ['w'] },
  }),
});

const fieldsOf = (body: { facets: Array<{ field: string }> }) =>
  body.facets.map((f) => f.field);

describe('createFacetsLister with rules', () => {
  const list = createFacetsLister(deps);

  it('lists only configured rules without rules (0.20.0)', () => {
    const body = list();
    expect(fieldsOf(body)).toEqual(['tag', 'alpha', 'beta']);
    expect(body.facets[0]).toMatchObject({
      values: ['x', 'y', 'z'],
      rules: ['a', 'b'],
    });
  });

  it("keeps only the named rules' fields and recorded values", () => {
    const body = list(['a']);
    expect(body.facets).toEqual([
      {
        field: 'tag',
        type: 'string',
        uiHint: 'tags',
        values: ['x', 'y'],
        rules: ['a'],
      },
      {
        field: 'alpha',
        type: 'string',
        uiHint: 'dropdown',
        values: ['1'],
        rules: ['a'],
      },
    ]);
  });

  it('accepts a virtual rule name', () => {
    const body = list(['v', 'b']);
    expect(fieldsOf(body)).toEqual(['tag', 'beta', 'gamma']);
    expect(body.facets[0]).toMatchObject({
      values: ['w', 'z'],
      rules: ['b', 'v'],
    });
    expect(body.facets[1].values).toEqual(['p', 'q']);
  });

  it('rejects an unknown rule name', () => {
    expect(() => list(['a', 'nope'])).toThrow('Unknown rule: nope');
  });
});

describe('GET /search/facets?rules= route', () => {
  async function inject(url: string) {
    const app = Fastify();
    await registerCatalogEntries(app, {
      listFacets: createCatalogFacetsHandler({
        ...deps,
        logger: pino({ level: 'silent' }),
      }),
    });
    const res = await app.inject({ method: 'GET', url });
    await app.close();
    return {
      status: res.statusCode,
      body: res.json<Record<string, unknown>>(),
    };
  }

  it('scopes by a comma-separated list', async () => {
    const { status, body } = await inject('/search/facets?rules=b,%20v');
    expect(status).toBe(200);
    expect(fieldsOf(body as never)).toEqual(['tag', 'beta', 'gamma']);
  });

  it('answers 400 invalid_request for an unknown rule', async () => {
    const { status, body } = await inject('/search/facets?rules=a,ghost');
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'invalid_request',
      error: 'Unknown rule: ghost',
    });
  });

  it('answers 400 when rules names no rule', async () => {
    const { status, body } = await inject('/search/facets?rules=');
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'invalid_request' });
  });

  it('ignores other query keys, as 0.20.0 did', async () => {
    const { status, body } = await inject('/search/facets?x=1');
    expect(status).toBe(200);
    expect(fieldsOf(body as never)).toEqual(['tag', 'alpha', 'beta']);
  });
});
