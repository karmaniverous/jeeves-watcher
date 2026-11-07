/**
 * @module util/postWithRetry.test
 * postWithRetry (D138, D180): POSTs JSON; retries a non-2xx response or network error up to three attempts; logs and returns false when all fail (never throws); a server that never answers fails each attempt at the per-attempt timeout and the helper settles; the default timeout is 10 s.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  POST_ATTEMPT_TIMEOUT_MS,
  POST_RETRY,
  postWithRetry,
} from './postWithRetry';

const fast = { baseDelayMs: 1, maxDelayMs: 1 };

function spyLogger() {
  const warn = vi.fn();
  const error = vi.fn();
  return { logger: { warn, error } as unknown as pino.Logger, warn, error };
}

/** A local server answering each request with `handler`. */
async function serve(
  handler: Parameters<typeof createServer>[1],
): Promise<{ url: string; server: Server; hits: () => number }> {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    handler?.(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/hook`,
    server,
    hits: () => hits,
  };
}

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

describe('postWithRetry', () => {
  it('POSTs the JSON payload and returns true on 2xx', async () => {
    let body = '';
    const target = await serve((req, res) => {
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => res.end('ok'));
    });
    servers.push(target.server);
    const { logger, error } = spyLogger();
    await expect(postWithRetry(target.url, { a: 1 }, logger)).resolves.toBe(
      true,
    );
    expect(JSON.parse(body)).toEqual({ a: 1 });
    expect(error).not.toHaveBeenCalled();
  });

  it('retries a non-2xx response, then succeeds', async () => {
    let n = 0;
    const target = await serve((_req, res) => {
      res.statusCode = n++ === 0 ? 503 : 200;
      res.end();
    });
    servers.push(target.server);
    const { logger, warn } = spyLogger();
    await expect(
      postWithRetry(target.url, {}, logger, { label: 'Alert', retry: fast }),
    ).resolves.toBe(true);
    expect(target.hits()).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, url: target.url }),
      'Alert failed; will retry',
    );
  });

  it('gives up after three attempts, logs with the extra fields, and returns false', async () => {
    const target = await serve((_req, res) => {
      res.statusCode = 500;
      res.end();
    });
    servers.push(target.server);
    const { logger, error } = spyLogger();
    await expect(
      postWithRetry(target.url, {}, logger, {
        label: 'Alert',
        logFields: { event: 'embedding_failed' },
        retry: fast,
      }),
    ).resolves.toBe(false);
    expect(target.hits()).toBe(3);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ url: target.url, event: 'embedding_failed' }),
      'Alert delivery failed; giving up',
    );
  });

  it('a network error counts as a failed attempt', async () => {
    const { logger, warn } = spyLogger();
    await expect(
      postWithRetry('http://127.0.0.1:9/none', {}, logger, { retry: fast }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('fails each attempt of a server that never answers at the timeout, and settles', async () => {
    const target = await serve(() => {
      // Never respond.
    });
    servers.push(target.server);
    // Attempts are counted on the client: under load the 50 ms timeout can
    // abort a request before it reaches the server, so server hits are only
    // bounded. Each attempt must end in the timeout's abort.
    const realFetch = globalThis.fetch;
    const failures: unknown[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (...args) => {
        try {
          return await realFetch(...args);
        } catch (err) {
          failures.push(err);
          throw err;
        }
      });
    const { logger, warn, error } = spyLogger();
    const started = Date.now();
    await expect(
      postWithRetry(target.url, {}, logger, { timeoutMs: 50, retry: fast }),
    ).resolves.toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(failures.map((e) => (e as Error).name)).toEqual([
      'TimeoutError',
      'TimeoutError',
      'TimeoutError',
    ]);
    expect(target.hits()).toBeGreaterThanOrEqual(1);
    expect(target.hits()).toBeLessThanOrEqual(3);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('uses a 10 s timeout per attempt and 3 attempts, 1 s base, 4 s cap by default', async () => {
    expect(POST_ATTEMPT_TIMEOUT_MS).toBe(10_000);
    expect(POST_RETRY).toEqual({
      attempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 4000,
    });
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const target = await serve((_req, res) => res.end());
    servers.push(target.server);
    await postWithRetry(target.url, {}, spyLogger().logger);
    expect(timeout).toHaveBeenCalledWith(10_000);
  });
});
