/**
 * @module vectorStore/scrollRetry.test
 * scrollPageWithRetry: passes filter, size, cursor and projection through; retries a failed page from the same cursor with growing delays; rethrows after the last attempt.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { SCROLL_RETRY_ATTEMPTS, scrollPageWithRetry } from './scrollRetry';

const logger = pino({ level: 'silent' });
const request = {
  filter: { must: [{ key: 'chunk_index', match: { value: 0 } }] },
  limit: 7,
  cursor: 'c1',
  fields: ['file_path'],
  label: 'Test',
};

describe('scrollPageWithRetry', () => {
  it('passes the request through and returns the page', async () => {
    const page = { points: [{ id: '1', payload: {} }], nextCursor: 'c2' };
    const scrollPage = vi.fn().mockResolvedValue(page);
    await expect(
      scrollPageWithRetry({ scrollPage }, request, logger),
    ).resolves.toBe(page);
    expect(scrollPage).toHaveBeenCalledWith(request.filter, 7, 'c1', [
      'file_path',
    ]);
  });

  it('retries from the same cursor with growing delays, then succeeds', async () => {
    const page = { points: [] };
    const scrollPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('reset'))
      .mockRejectedValueOnce(new Error('reset'))
      .mockResolvedValue(page);
    const sleeps: number[] = [];
    const sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    await expect(
      scrollPageWithRetry({ scrollPage }, request, logger, sleep),
    ).resolves.toBe(page);
    expect(scrollPage).toHaveBeenCalledTimes(3);
    for (const call of scrollPage.mock.calls) expect(call[2]).toBe('c1');
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1000);
    expect(sleeps[0]).toBeLessThan(1500);
    expect(sleeps[1]).toBeGreaterThanOrEqual(2000);
    expect(sleeps[1]).toBeLessThan(2500);
  });

  it('rethrows the last error after the last attempt', async () => {
    const scrollPage = vi.fn().mockRejectedValue(new Error('down'));
    const sleep = vi.fn(() => Promise.resolve());
    await expect(
      scrollPageWithRetry({ scrollPage }, request, logger, sleep),
    ).rejects.toThrow('down');
    expect(scrollPage).toHaveBeenCalledTimes(SCROLL_RETRY_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(SCROLL_RETRY_ATTEMPTS - 1);
  });
});
