/**
 * @module api/catalog/rulesRegisterHandler.test
 * POST /rules/register over the catalog route: registers rules and fires onRulesChanged; a missing source, non-array rules or unnamed rules (the catalog's validation), duplicate names and uncompilable match schemas (the handler's `RulesInvalid`) are 400 (`FST_ERR_VALIDATION` and `WATCHER_INVALID_REQUEST` respectively) with nothing registered.
 */

import Fastify from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { VirtualRuleStore } from '../../rules/virtualRules';
import { registerCatalogEntries } from '../../test/catalogRoutes';
import {
  type CatalogRuleDeps,
  createCatalogRulesRegisterHandler,
} from './rulesRegisterHandler';

const makeDeps = (): CatalogRuleDeps => ({
  virtualRuleStore: new VirtualRuleStore(),
  logger: pino({ level: 'silent' }),
  onRulesChanged: vi.fn(),
});

const rule = (name: string, match: unknown = { type: 'object' }) => ({
  name,
  description: 'A test rule',
  match,
});

/** POST the body; return the status and the sent body. */
async function invoke(deps: CatalogRuleDeps, body: unknown) {
  const app = Fastify({ logger: false });
  await registerCatalogEntries(app, {
    registerRules: createCatalogRulesRegisterHandler(deps),
  });
  const res = await app.inject({
    method: 'POST',
    url: '/rules/register',
    ...(body === undefined ? {} : { payload: body as object }),
  });
  await app.close();
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

describe('POST /rules/register', () => {
  it('registers rules and calls onRulesChanged', async () => {
    const deps = makeDeps();
    const rules = [
      {
        ...rule('test-rule'),
        schema: [
          {
            type: 'object',
            properties: { domain: { type: 'string', set: 'test' } },
          },
        ],
      },
    ];

    const res = await invoke(deps, { source: 'my-plugin', rules });

    expect(res).toEqual({
      status: 200,
      body: { source: 'my-plugin', registered: 1, totalVirtualRules: 1 },
    });
    expect(deps.virtualRuleStore.size).toBe(1);
    expect(deps.onRulesChanged).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing source', { rules: [] }, 'FST_ERR_VALIDATION'],
    ['no body', undefined, 'FST_ERR_VALIDATION'],
    ['non-array rules', { source: 'p', rules: 'x' }, 'FST_ERR_VALIDATION'],
    [
      'an unnamed rule',
      { source: 'p', rules: [{ match: {} }] },
      'FST_ERR_VALIDATION',
    ],
    [
      'duplicate names',
      { source: 'p', rules: [rule('a'), rule('a')] },
      'WATCHER_INVALID_REQUEST',
    ],
    [
      'a match schema that does not compile',
      { source: 'p', rules: [rule('a', { type: 'no-such-type' })] },
      'WATCHER_INVALID_REQUEST',
    ],
  ])('rejects %s with 400 %s', async (_label, body, code) => {
    const deps = makeDeps();

    const res = await invoke(deps, body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code });
    const { message } = res.body as { message: string };
    expect(message.startsWith('The rules are not valid: ')).toBe(
      code === 'WATCHER_INVALID_REQUEST',
    );
    expect(deps.virtualRuleStore.size).toBe(0);
    expect(deps.onRulesChanged).not.toHaveBeenCalled();
  });
});
