/**
 * @module api/handlers/rulesUnregister.test
 * DELETE /rules/unregister (body) and /rules/unregister/:source (param): a missing or empty source is 400 invalid_request; removal answers `removed: true` and fires onRulesChanged once; an unknown source answers `removed: false` without firing it.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VirtualRuleStore } from '../../rules/virtualRules';
import {
  createRulesUnregisterHandler,
  createRulesUnregisterParamHandler,
} from './rulesUnregister';

let store: VirtualRuleStore;
let onRulesChanged: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  store = new VirtualRuleStore();
  store.register('my-plugin', [
    { name: 'r1', description: 'A rule', match: { type: 'object' } },
  ]);
  onRulesChanged = vi.fn<() => void>();
});

const deps = () => ({
  virtualRuleStore: store,
  logger: pino({ level: 'silent' }),
  onRulesChanged,
});

/** Invoke a handler with a request; return the status (if set) and body. */
async function invoke(
  handler: (request: never, reply: never) => Promise<void>,
  request: object,
) {
  const status = vi.fn().mockReturnThis();
  const send = vi.fn();
  await handler(request as never, { status, send } as never);
  return {
    status: status.mock.calls[0]?.[0] as number | undefined,
    body: send.mock.calls[0]?.[0] as Record<string, unknown>,
  };
}

const variants = [
  [
    'body',
    () => createRulesUnregisterHandler(deps()),
    (source?: unknown) => ({
      body: source === undefined ? undefined : { source },
    }),
  ],
  [
    'param',
    () => createRulesUnregisterParamHandler(deps()),
    (source?: unknown) => ({ params: { source } }),
  ],
] as const;

describe.each(variants)('rules unregister (%s)', (_label, make, request) => {
  it('removes the source and fires onRulesChanged once', async () => {
    const res = await invoke(make(), request('my-plugin'));
    expect(res.body).toEqual({ source: 'my-plugin', removed: true });
    expect(store.size).toBe(0);
    expect(onRulesChanged).toHaveBeenCalledOnce();
  });

  it('answers removed: false for an unknown source without firing', async () => {
    const res = await invoke(make(), request('other'));
    expect(res.body).toEqual({ source: 'other', removed: false });
    expect(store.size).toBe(1);
    expect(onRulesChanged).not.toHaveBeenCalled();
  });

  it.each([[undefined], ['']])(
    'rejects source %j with 400 invalid_request',
    async (source) => {
      const res = await invoke(make(), request(source));
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'invalid_request',
        error: 'Missing required field: source',
      });
      expect(store.size).toBe(1);
      expect(onRulesChanged).not.toHaveBeenCalled();
    },
  );
});
