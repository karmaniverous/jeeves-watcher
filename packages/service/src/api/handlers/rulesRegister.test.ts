/**
 * @module api/handlers/rulesRegister.test
 * POST /rules/register: registers rules and fires onRulesChanged; missing source, non-array rules, unnamed rules, duplicate names and uncompilable match schemas are 400 invalid_request with nothing registered.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { VirtualRuleStore } from '../../rules/virtualRules';
import type { RulesRegisterDeps } from './rulesRegister';
import { createRulesRegisterHandler } from './rulesRegister';

const makeDeps = (): RulesRegisterDeps => ({
  virtualRuleStore: new VirtualRuleStore(),
  logger: pino({ level: 'silent' }),
  onRulesChanged: vi.fn(),
});

const rule = (name: string, match: unknown = { type: 'object' }) => ({
  name,
  description: 'A test rule',
  match,
});

/** Invoke the handler; return the status (if set) and the sent body. */
async function invoke(deps: RulesRegisterDeps, body: unknown) {
  const status = vi.fn().mockReturnThis();
  const send = vi.fn();
  const reply = { status, send } as never;
  await createRulesRegisterHandler(deps)({ body } as never, reply);
  return {
    status: status.mock.calls[0]?.[0] as number | undefined,
    body: send.mock.calls[0]?.[0] as Record<string, unknown>,
  };
}

describe('createRulesRegisterHandler', () => {
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

    const { body } = await invoke(deps, { source: 'my-plugin', rules });

    expect(body).toEqual({
      source: 'my-plugin',
      registered: 1,
      totalVirtualRules: 1,
    });
    expect(deps.virtualRuleStore.size).toBe(1);
    expect(deps.onRulesChanged).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing source', { rules: [] }],
    ['no body', undefined],
    ['non-array rules', { source: 'p', rules: 'x' }],
    ['an unnamed rule', { source: 'p', rules: [{ match: {} }] }],
    ['duplicate names', { source: 'p', rules: [rule('a'), rule('a')] }],
    [
      'a match schema that does not compile',
      { source: 'p', rules: [rule('a', { type: 'no-such-type' })] },
    ],
  ])('rejects %s with 400 invalid_request', async (_label, body) => {
    const deps = makeDeps();

    const res = await invoke(deps, body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_request' });
    expect(deps.virtualRuleStore.size).toBe(0);
    expect(deps.onRulesChanged).not.toHaveBeenCalled();
  });
});
