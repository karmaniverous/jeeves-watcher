/**
 * @module api/catalog/wrapCatalogHandler.test
 * Behaviour of `wrapCatalogHandler` and `toCallerError`: success is sent as
 * `{status: 200, body, headers?}`; a lock timeout or an unavailable embedding
 * provider becomes its `defineError` class with `Retry-After` (logged at
 * `warn`); every other throw is rethrown unchanged, so jeeves masks it.
 */

import type pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import { DocumentLockTimeoutError } from '../../processor/DocumentLocks';
import { LockWaitTimeoutError } from '../../vcs/RootGitLock';
import {
  DocumentBusy,
  EmbeddingUnavailable,
  ScanInProgress,
  VcsBusy,
} from '../errors';
import { toCallerError, wrapCatalogHandler } from './wrapCatalogHandler';

function mockLogger(): pino.Logger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as pino.Logger;
}

const input = { params: {}, query: {}, body: {} };

describe('wrapCatalogHandler', () => {
  it('sends a success body with status 200', async () => {
    const handler = wrapCatalogHandler(
      () => Promise.resolve({ body: { ok: true } }),
      mockLogger(),
      'Test',
    );
    expect(await handler(input, {} as never)).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it('includes headers when the function returns them', async () => {
    const handler = wrapCatalogHandler(
      () =>
        Promise.resolve({
          body: { ok: true },
          headers: { 'Cache-Control': 'no-cache' },
        }),
      mockLogger(),
      'Test',
    );
    expect(await handler(input, {} as never)).toEqual({
      status: 200,
      body: { ok: true },
      headers: { 'Cache-Control': 'no-cache' },
    });
  });

  it('rethrows a thrown watcher class unchanged', async () => {
    const error = new ScanInProgress();
    const handler = wrapCatalogHandler(
      () => Promise.reject(error),
      mockLogger(),
      'Test',
    );
    await expect(handler(input, {} as never)).rejects.toBe(error);
  });

  it('rethrows an unexpected error unchanged, unlogged (jeeves logs it)', async () => {
    const logger = mockLogger();
    const error = new Error('/secret/path failed');
    const handler = wrapCatalogHandler(
      () => Promise.reject(error),
      logger,
      'Test',
    );
    await expect(handler(input, {} as never)).rejects.toBe(error);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps a document lock timeout on the way out', async () => {
    const handler = wrapCatalogHandler(
      () => Promise.reject(new DocumentLockTimeoutError('k', 'op', 10_000)),
      mockLogger(),
      'Test',
    );
    await expect(handler(input, {} as never)).rejects.toBeInstanceOf(
      DocumentBusy,
    );
  });
});

describe('toCallerError', () => {
  it('maps a document lock timeout to DocumentBusy with Retry-After: 10', () => {
    const logger = mockLogger();
    const error = toCallerError(
      new DocumentLockTimeoutError('file:a', 'render', 10_000),
      logger,
      'Render',
    );
    expect(error).toBeInstanceOf(DocumentBusy);
    expect(error).toMatchObject({
      statusCode: 503,
      code: 'WATCHER_NOT_AVAILABLE',
      message: 'The document is being processed; retry after 10 s.',
      headers: { 'retry-after': '10' },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { route: 'Render', key: 'file:a', waitMs: 10_000 },
      'Render gave up waiting for a document lock',
    );
  });

  it('maps a root git lock timeout to VcsBusy with Retry-After: 30', () => {
    const logger = mockLogger();
    const error = toCallerError(
      new LockWaitTimeoutError('/r', 'exclude', 30_000, 'commit'),
      logger,
      'VcsExclude',
    );
    expect(error).toBeInstanceOf(VcsBusy);
    expect(error).toMatchObject({
      statusCode: 503,
      code: 'WATCHER_NOT_AVAILABLE',
      message: 'Version control is busy on this root; retry after 30 s.',
      headers: { 'retry-after': '30' },
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('maps an unavailable embedding provider to EmbeddingUnavailable', () => {
    const logger = mockLogger();
    const error = toCallerError(
      new EmbeddingUnavailableError('down', { retryAfterMs: 1500 }),
      logger,
      'Search',
    );
    expect(error).toBeInstanceOf(EmbeddingUnavailable);
    expect(error).toMatchObject({ headers: { 'retry-after': '2' } });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns any other error unchanged, unlogged', () => {
    const logger = mockLogger();
    const error = new TypeError('boom');
    expect(toCallerError(error, logger, 'Scan')).toBe(error);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
