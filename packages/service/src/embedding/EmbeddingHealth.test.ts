/**
 * @module embedding/EmbeddingHealth.test
 * Embedding health (D86, D88, D89) on a fake clock: lastSuccessAt null before the first success; failing needs 3 failures and 60 s without a success; alternating success/failure at concurrency 50 for 5 minutes never alerts; a 2-minute outage alerts exactly once each way; error codes, never provider text; back-off end from the limiter.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  embeddingErrorCode,
  EmbeddingHealth,
  type EmbeddingTransition,
  FAILING_MIN_FAILURES,
  FAILING_MIN_MS,
} from './EmbeddingHealth';
import { EmbeddingUnavailableError } from './rateLimitError';

const START = Date.parse('2026-11-04T00:00:00.000Z');

/** A provider whose outcome the test controls, and a clock. */
function setup(backoffUntilMs?: number) {
  let now = START;
  let failing = false;
  const transitions: EmbeddingTransition[] = [];
  const logger = pino({ level: 'silent' });
  const error = vi.spyOn(logger, 'error');
  const info = vi.spyOn(logger, 'info');
  const inner = {
    dimensions: 3,
    backoffUntilMs,
    embed: vi.fn((texts: string[]) =>
      failing
        ? Promise.reject(
            new Error('Gemini API error 503: secret provider text'),
          )
        : Promise.resolve(texts.map(() => [0, 0, 0])),
    ),
  };
  const health = new EmbeddingHealth(inner, {
    logger,
    now: () => now,
    onTransition: (t) => transitions.push(t),
  });
  return {
    health,
    inner,
    transitions,
    error,
    info,
    advance: (ms: number) => {
      now += ms;
    },
    setFailing: (value: boolean) => {
      failing = value;
    },
    call: () => health.embed(['x']).catch(() => undefined),
  };
}

describe('EmbeddingHealth', () => {
  it('starts ok with lastSuccessAt null before the first success', async () => {
    const t = setup();
    expect(t.health.dimensions).toBe(3);
    expect(t.health.snapshot()).toEqual({
      state: 'ok',
      lastSuccessAt: null,
      lastError: null,
      failingSince: null,
      backoffUntil: null,
    });
    await t.call();
    expect(t.health.snapshot().lastSuccessAt).toBe(
      new Date(START).toISOString(),
    );
  });

  it('turns failing only after 3 failures and 60 s without a success (down at startup)', async () => {
    const t = setup();
    t.setFailing(true);
    for (let i = 0; i < 5; i++) await t.call();
    expect(t.health.snapshot().state).toBe('ok');
    t.advance(FAILING_MIN_MS - 1);
    await t.call();
    expect(t.health.snapshot().state).toBe('ok');
    t.advance(1);
    await t.call();
    const snap = t.health.snapshot();
    expect(snap.state).toBe('failing');
    expect(snap.failingSince).toBe(
      new Date(START + FAILING_MIN_MS).toISOString(),
    );
    expect(t.transitions).toHaveLength(1);
    expect(t.error).toHaveBeenCalledWith(
      expect.objectContaining({ failures: 7, code: 'http_503' }),
      'Embedding provider failing',
    );
  });

  it('needs 3 failures even after 60 s without a success', async () => {
    const t = setup();
    await t.call();
    t.setFailing(true);
    t.advance(10 * FAILING_MIN_MS);
    for (let i = 1; i < FAILING_MIN_FAILURES; i++) await t.call();
    expect(t.health.snapshot().state).toBe('ok');
    await t.call();
    expect(t.health.snapshot().state).toBe('failing');
  });

  it('never alerts when success and failure alternate at concurrency 50 for 5 minutes', async () => {
    const t = setup();
    for (let second = 0; second < 300; second++) {
      t.setFailing(second % 2 === 1);
      await Promise.all(Array.from({ length: 50 }, () => t.call()));
      t.advance(1000);
    }
    expect(t.transitions).toEqual([]);
    expect(t.health.snapshot().state).toBe('ok');
  });

  it('a 2-minute outage alerts exactly once failed and once recovered', async () => {
    const t = setup();
    await t.call();
    t.setFailing(true);
    for (let second = 0; second < 120; second++) {
      await Promise.all(Array.from({ length: 5 }, () => t.call()));
      t.advance(1000);
    }
    t.setFailing(false);
    await t.call();
    await t.call();
    expect(t.transitions.map((x) => x.event)).toEqual([
      'embedding_failed',
      'embedding_recovered',
    ]);
    const [failed, recovered] = t.transitions;
    expect(failed.failingSince).toBe(
      new Date(START + FAILING_MIN_MS).toISOString(),
    );
    expect(failed.lastError).toEqual({ at: failed.at, code: 'http_503' });
    expect(recovered.failingSince).toBe(failed.failingSince);
    expect(recovered.at).toBe(new Date(START + 120_000).toISOString());
    expect(t.info).toHaveBeenCalledWith(
      { failingSince: failed.failingSince },
      'Embedding provider recovered',
    );
    const snap = t.health.snapshot();
    expect(snap.state).toBe('ok');
    expect(snap.failingSince).toBeNull();
    // Health shows the code only, never the provider's text.
    expect(JSON.stringify(snap)).not.toContain('secret');
  });

  it('a rate-limit wait that succeeds is not a failure', async () => {
    const t = setup();
    t.inner.embed.mockImplementationOnce(
      (texts: string[]) =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(texts.map(() => [0, 0, 0]));
          }, 5);
        }),
    );
    await t.call();
    expect(t.health.snapshot().lastError).toBeNull();
  });

  it('reports the limiter back-off end, and none when there is none', () => {
    const until = START + 300_000;
    expect(setup(until).health.snapshot().backoffUntil).toBe(
      new Date(until).toISOString(),
    );
    expect(setup().health.snapshot().backoffUntil).toBeNull();
  });

  it('rethrows the provider error', async () => {
    const t = setup();
    t.setFailing(true);
    await expect(t.health.embed(['x'])).rejects.toThrow('secret provider text');
  });

  it('works without a transition callback', async () => {
    const health = new EmbeddingHealth(
      { dimensions: 1, embed: () => Promise.reject(new Error('x')) },
      { logger: pino({ level: 'silent' }), now: () => START },
    );
    await health.embed(['a']).catch(() => undefined);
    expect(health.snapshot().lastError?.code).toBe('error');
  });
});

describe('embeddingErrorCode', () => {
  it.each([
    [new EmbeddingUnavailableError('wait'), 'rate_limited'],
    [Object.assign(new Error('t'), { name: 'TimeoutError' }), 'timeout'],
    [Object.assign(new Error('a'), { name: 'AbortError' }), 'timeout'],
    [Object.assign(new Error('s'), { status: 429 }), 'http_429'],
    [new Error('Gemini API error 500: boom'), 'http_500'],
    [Object.assign(new Error('n'), { code: 'ECONNRESET' }), 'network'],
    [Object.assign(new Error('n'), { code: 'weird' }), 'error'],
    [new Error('other'), 'error'],
    ['a string', 'error'],
  ])('%s -> %s', (error, code) => {
    expect(embeddingErrorCode(error)).toBe(code);
  });
});
