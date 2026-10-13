/**
 * @module api/reindexCallback.test
 * reportReindexCompletion: no request without `reindex.callbackUrl`; POSTs the JSON payload; retries a non-OK response; after three failed attempts logs the delivery failure and resolves (never throws). Fake timers, stubbed fetch.
 */

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { reportReindexCompletion } from './reindexCallback';

const logger = pino({ level: 'silent' });
const CALLBACK_URL = 'http://127.0.0.1:9/callback';
const withUrl = {
  reindex: { callbackUrl: CALLBACK_URL },
} as JeevesWatcherConfig;
const payload = { scope: 'full', filesProcessed: 2, errors: [] };

const fetchMock =
  vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('reportReindexCompletion', () => {
  it('does nothing without a callback URL', async () => {
    await reportReindexCompletion({} as JeevesWatcherConfig, payload, logger);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the payload as JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await reportReindexCompletion(withUrl, payload, logger);
    expect(fetchMock).toHaveBeenCalledWith(CALLBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  it('retries a failed delivery', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const done = reportReindexCompletion(withUrl, payload, logger);
    await vi.runAllTimersAsync();
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'a non-OK response',
      () => fetchMock.mockResolvedValue({ ok: false, status: 500 }),
    ],
    [
      'a network error',
      () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED')),
    ],
  ])(
    'gives up after three attempts on %s, logs and resolves',
    async (_, arrange) => {
      arrange();
      const error = vi.fn();
      const spyLogger = { warn: vi.fn(), error } as unknown as pino.Logger;
      const done = reportReindexCompletion(withUrl, payload, spyLogger);
      await vi.runAllTimersAsync();
      await expect(done).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toMatchObject({
        url: CALLBACK_URL,
        scope: 'full',
      });
    },
  );
});
