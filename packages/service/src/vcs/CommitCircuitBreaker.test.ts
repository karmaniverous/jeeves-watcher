/**
 * @module vcs/CommitCircuitBreaker.test
 * Breaker state machine with an injected clock: trip threshold, cooldown,
 * half-open, re-arm, and reset.
 */

import { describe, expect, it } from 'vitest';

import { CommitCircuitBreaker } from './CommitCircuitBreaker';

function makeBreaker(max = 3, cooldownMs = 1000) {
  const clock = { now: 10_000 };
  const breaker = new CommitCircuitBreaker(max, cooldownMs, () => clock.now);
  return { breaker, clock };
}

describe('CommitCircuitBreaker', () => {
  it('stays closed below the threshold, recording the latest error', () => {
    const { breaker } = makeBreaker(3);

    expect(breaker.recordFailure('first')).toBe(false);
    expect(breaker.recordFailure('second')).toBe(false);

    expect(breaker.isTripped).toBe(false);
    expect(breaker.remainingCooldownMs()).toBe(0);
    expect(breaker.snapshot()).toEqual({
      consecutiveFailures: 2,
      tripped: false,
      trippedAt: null,
      lastError: 'second',
    });
  });

  it('trips at the threshold and reports the trip time', () => {
    const { breaker, clock } = makeBreaker(2);
    breaker.recordFailure('a');

    expect(breaker.recordFailure('b')).toBe(true);

    expect(breaker.isTripped).toBe(true);
    expect(breaker.snapshot().trippedAt).toBe(
      new Date(clock.now).toISOString(),
    );
  });

  it('counts the cooldown down and goes half-open when it elapses', () => {
    const { breaker, clock } = makeBreaker(1, 1000);
    breaker.recordFailure('x');

    expect(breaker.remainingCooldownMs()).toBe(1000);
    clock.now += 400;
    expect(breaker.remainingCooldownMs()).toBe(600);
    clock.now += 600;
    expect(breaker.remainingCooldownMs()).toBe(0);
    clock.now += 5000;
    expect(breaker.remainingCooldownMs()).toBe(0);
    // Half-open is still tripped until an attempt succeeds.
    expect(breaker.isTripped).toBe(true);
  });

  it('re-arms the cooldown from the time of a failed half-open attempt', () => {
    const { breaker, clock } = makeBreaker(1, 1000);
    breaker.recordFailure('x');
    clock.now += 1500; // half-open

    expect(breaker.recordFailure('still broken')).toBe(true);

    expect(breaker.remainingCooldownMs()).toBe(1000);
    expect(breaker.snapshot()).toMatchObject({
      consecutiveFailures: 2,
      trippedAt: new Date(clock.now).toISOString(),
      lastError: 'still broken',
    });
  });

  it('resets everything on success and says whether it had been tripped', () => {
    const { breaker } = makeBreaker(1);
    breaker.recordFailure('x');

    expect(breaker.recordSuccess()).toBe(true);
    expect(breaker.snapshot()).toEqual({
      consecutiveFailures: 0,
      tripped: false,
      trippedAt: null,
      lastError: null,
    });
    expect(breaker.recordSuccess()).toBe(false);
  });

  it('needs the full threshold again after a success', () => {
    const { breaker } = makeBreaker(2);
    breaker.recordFailure('a');
    breaker.recordSuccess();

    expect(breaker.recordFailure('b')).toBe(false);
    expect(breaker.recordFailure('c')).toBe(true);
  });
});
