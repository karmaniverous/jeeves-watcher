import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { SystemHealth } from './index';

const logger = pino({ level: 'silent' });

describe('SystemHealth', () => {
  it('starts with zero failures', () => {
    const health = new SystemHealth({ logger });
    expect(health.failures).toBe(0);
    expect(health.currentBackoffMs).toBe(0);
  });

  it('tracks consecutive failures with exponential backoff', () => {
    const health = new SystemHealth({
      logger,
      baseDelayMs: 1000,
      maxBackoffMs: 60_000,
    });

    health.recordFailure(new Error('fail 1'));
    expect(health.failures).toBe(1);
    expect(health.currentBackoffMs).toBe(1000);

    health.recordFailure(new Error('fail 2'));
    expect(health.failures).toBe(2);
    expect(health.currentBackoffMs).toBe(2000);

    health.recordFailure(new Error('fail 3'));
    expect(health.failures).toBe(3);
    expect(health.currentBackoffMs).toBe(4000);
  });

  it('caps backoff at maxBackoffMs', () => {
    const health = new SystemHealth({
      logger,
      baseDelayMs: 1000,
      maxBackoffMs: 3000,
    });

    health.recordFailure(new Error('1'));
    health.recordFailure(new Error('2'));
    health.recordFailure(new Error('3'));
    health.recordFailure(new Error('4'));

    expect(health.currentBackoffMs).toBe(3000);
  });

  it('resets on success', () => {
    const health = new SystemHealth({ logger });

    health.recordFailure(new Error('fail'));
    expect(health.failures).toBe(1);

    health.recordSuccess();
    expect(health.failures).toBe(0);
    expect(health.currentBackoffMs).toBe(0);
  });

  it('calls onFatalError when maxRetries exceeded', () => {
    const onFatalError = vi.fn();
    const health = new SystemHealth({
      logger,
      maxRetries: 2,
      onFatalError,
    });

    health.recordFailure(new Error('fail 1'));
    expect(onFatalError).not.toHaveBeenCalled();

    const shouldContinue = health.recordFailure(new Error('fail 2'));
    expect(shouldContinue).toBe(false);
    expect(onFatalError).toHaveBeenCalledOnce();
  });

  it('throws when maxRetries exceeded and no onFatalError', () => {
    const health = new SystemHealth({
      logger,
      maxRetries: 1,
    });

    expect(() => health.recordFailure(new Error('boom'))).toThrow('boom');
  });

  it('backoff resolves immediately when no failures', async () => {
    const health = new SystemHealth({ logger });
    const start = Date.now();
    await health.backoff();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('backoff waits for the computed delay', async () => {
    const health = new SystemHealth({
      logger,
      baseDelayMs: 50,
      maxBackoffMs: 200,
    });

    health.recordFailure(new Error('fail'));
    const start = Date.now();
    await health.backoff();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(200);
  });

  it('backoff can be aborted', async () => {
    const health = new SystemHealth({
      logger,
      baseDelayMs: 10_000,
      maxBackoffMs: 60_000,
    });

    health.recordFailure(new Error('fail'));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    await expect(health.backoff(controller.signal)).rejects.toThrow(
      'Backoff aborted',
    );
  });
});
