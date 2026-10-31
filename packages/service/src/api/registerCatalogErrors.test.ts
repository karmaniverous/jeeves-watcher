/**
 * @module api/registerCatalogErrors.test
 * `registerCatalog` returns synchronously and a catalog registration error surfaces from `ready()`, not from the call (spec #281 D29).
 */

import Fastify from 'fastify';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import {
  registerCatalog,
  type RegisterCatalogOptions,
} from './registerCatalog';

/** Handler dependencies are only used when a route runs; none runs here. */
const options = {
  logger: pino({ level: 'silent' }),
  responseValidation: 'strict',
  handlers: {
    cacheTtlMs: 0,
    status: {},
    config: {},
    configApply: {},
    render: {},
    search: {},
    scan: {},
    vcsShow: {},
  },
} as unknown as RegisterCatalogOptions;

describe('registerCatalog registration errors', () => {
  it('returns synchronously and rejects ready() when a catalog route collides', async () => {
    const app = Fastify({ logger: false });
    app.post('/search', () => ({}));

    expect(registerCatalog(app, options)).toBeUndefined();
    await expect(app.ready()).rejects.toThrow(/search/);
  });

  it('becomes ready when nothing collides', async () => {
    const app = Fastify({ logger: false });
    registerCatalog(app, options);

    await expect(app.ready()).resolves.toBe(app);
    await app.close();
  });
});
