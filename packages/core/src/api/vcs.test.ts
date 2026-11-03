/**
 * @module api/vcs.test
 * Tests for the GET /vcs/status response schema's typed push errors and breaker.
 */

import { describe, expect, it } from 'vitest';

import { vcsStatusResponseSchema } from './vcs';

const root = {
  path: '/r',
  tracked: 1,
  lastCommit: null,
  remoteUrl: null,
  lastPush: null,
  pushErrors: [{ timestamp: '2026-11-03T00:00:00.000Z', message: 'denied' }],
  breaker: {
    consecutiveFailures: 0,
    tripped: false,
    trippedAt: null,
    lastError: null,
    pendingCount: 0,
  },
};

const parse = (overrides: Record<string, unknown>) =>
  vcsStatusResponseSchema.safeParse({
    enabled: true,
    roots: [{ ...root, ...overrides }],
  }).success;

describe('vcsStatusResponseSchema', () => {
  it('accepts push errors and a breaker snapshot, or no breaker', () => {
    expect(parse({})).toBe(true);
    expect(parse({ breaker: null })).toBe(true);
  });

  it('rejects a push error without a message', () => {
    expect(parse({ pushErrors: [{ timestamp: 'x' }] })).toBe(false);
  });

  it('rejects a breaker without its trip state', () => {
    expect(parse({ breaker: { ...root.breaker, tripped: undefined } })).toBe(
      false,
    );
  });
});
