import { describe, expect, it, vi } from 'vitest';

import { VirtualRuleStore } from '../../rules/virtualRules';
import type { RulesRegisterDeps } from './rulesRegister';
import { createRulesRegisterHandler } from './rulesRegister';

describe('createRulesRegisterHandler', () => {
  const makeDeps = (): RulesRegisterDeps => ({
    virtualRuleStore: new VirtualRuleStore(),
    logger: { info: vi.fn(), error: vi.fn() } as never,
    onRulesChanged: vi.fn(),
  });

  it('registers rules and calls onRulesChanged', async () => {
    const deps = makeDeps();
    const handler = createRulesRegisterHandler(deps);

    const rules = [
      {
        name: 'test-rule',
        description: 'A test rule',
        match: { type: 'object' },
        schema: [
          {
            type: 'object',
            properties: { domain: { type: 'string', set: 'test' } },
          },
        ],
      },
    ];

    const request = { body: { source: 'my-plugin', rules } } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(deps.virtualRuleStore.size).toBe(1);
    expect(deps.onRulesChanged).toHaveBeenCalledOnce();
  });

  it('rejects missing source', async () => {
    const deps = makeDeps();
    const handler = createRulesRegisterHandler(deps);

    const request = { body: { rules: [] } } as never;
    const statusMock = vi.fn().mockReturnThis();
    const reply = { status: statusMock, send: vi.fn() } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(500);
  });
});
