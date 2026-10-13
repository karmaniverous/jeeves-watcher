/**
 * @module api/reindexCallback.test
 * reportReindexCompletion: no request without `reindex.callbackUrl`; POSTs the JSON payload; retries a non-OK response and rejects after three attempts. Fake timers, stubbed fetch.
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

  it('gives up after three attempts', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const done = reportReindexCompletion(withUrl, payload, logger);
    const settled = done.then(
      () => undefined,
      (e: unknown) => e,
    );
    await vi.runAllTimersAsync();
    expect(await settled).toMatchObject({ message: 'Non-OK response: 500' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
