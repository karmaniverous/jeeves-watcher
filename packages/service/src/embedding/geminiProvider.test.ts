import { EventEmitter } from 'node:events';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingConfig } from '../config/types';
import { createGeminiProvider } from './geminiProvider';
import {
  EmbeddingRateLimitError,
  EmbeddingUnavailableError,
} from './rateLimitError';

interface FakeResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

const { responses, request } = vi.hoisted(() => {
  const responses: FakeResponse[] = [];
  const request = vi.fn();
  return { responses, request };
});

vi.mock('node:https', () => ({
  default: {
    Agent: vi.fn(),
    request,
  },
}));

function installFakeRequest() {
  request.mockImplementation(
    (_options: unknown, onResponse: (res: EventEmitter) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
      };
      req.write = () => undefined;
      req.end = () => {
        const next = responses.shift() ?? { status: 500, body: 'no response' };
        const res = Object.assign(new EventEmitter(), {
          statusCode: next.status,
          headers: next.headers ?? {},
        });
        onResponse(res);
        res.emit('data', Buffer.from(next.body));
        res.emit('end');
      };
      return req;
    },
  );
}

const config = {
  provider: 'gemini',
  model: 'gemini-embedding-001',
  dimensions: 2,
  apiKey: 'test-key',
} as EmbeddingConfig;

const okBody = JSON.stringify({
  embeddings: [{ values: [0.1, 0.2] }],
});

describe('createGeminiProvider', () => {
  beforeEach(() => {
    responses.length = 0;
    request.mockReset();
    installFakeRequest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns vectors on success', async () => {
    responses.push({ status: 200, body: okBody });
    const provider = createGeminiProvider(config);
    await expect(provider.embed(['a'])).resolves.toEqual([[0.1, 0.2]]);
  });

  it('surfaces 429 with Retry-After as EmbeddingRateLimitError, without retrying', async () => {
    responses.push({
      status: 429,
      body: '{"error":{"status":"RESOURCE_EXHAUSTED"}}',
      headers: { 'retry-after': '7' },
    });
    const provider = createGeminiProvider(config);

    const error = await provider.embed(['a']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingRateLimitError);
    expect((error as EmbeddingRateLimitError).retryAfterMs).toBe(7_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('still retries non-429 failures with backoff', async () => {
    vi.useFakeTimers();
    responses.push({ status: 503, body: 'unavailable' });
    responses.push({ status: 200, body: okBody });
    const provider = createGeminiProvider(config, pino({ level: 'silent' }));

    const result = provider.embed(['a']);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toEqual([[0.1, 0.2]]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('awaits beforeRetry before every retry request (one limiter token each)', async () => {
    vi.useFakeTimers();
    responses.push({ status: 503, body: 'unavailable' });
    responses.push({ status: 500, body: 'error' });
    responses.push({ status: 200, body: okBody });
    const beforeRetry = vi.fn(() => {
      // The token is taken before the request is sent.
      expect(request).toHaveBeenCalledTimes(beforeRetry.mock.calls.length);
      return Promise.resolve();
    });
    const provider = createGeminiProvider(config, pino({ level: 'silent' }));

    const result = provider.embed(['a'], { beforeRetry });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual([[0.1, 0.2]]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(beforeRetry).toHaveBeenCalledTimes(2);
  });

  it('stops retrying when beforeRetry rejects with EmbeddingUnavailableError', async () => {
    vi.useFakeTimers();
    responses.push({ status: 503, body: 'unavailable' });
    const unavailable = new EmbeddingUnavailableError('budget exhausted');
    const beforeRetry = vi.fn(() => Promise.reject(unavailable));
    const provider = createGeminiProvider(config, pino({ level: 'silent' }));

    const result = provider
      .embed(['a'], { beforeRetry })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toBe(unavailable);
    expect(request).toHaveBeenCalledTimes(1);
    expect(beforeRetry).toHaveBeenCalledOnce();
  });
});
