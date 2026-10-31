/**
 * @module api/catalog/wrapCatalogHandler.test
 * Behaviour of `wrapCatalogHandler` and `catalogErrorFromThrown`: success is
 * sent as `{status: 200, body, headers?}`; a thrown `RequestError` becomes
 * its code/status/extras (logged at `debug`); any other throw is logged at
 * `error` and becomes a generic `internal_error` (never leaking the error).
 */

import type pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { RequestError } from '../requestError';
import {
  catalogErrorFromThrown,
  wrapCatalogHandler,
} from './wrapCatalogHandler';

function mockLogger(): pino.Logger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as pino.Logger;
}

describe('wrapCatalogHandler', () => {
  it('sends a success body with status 200', async () => {
    const handler = wrapCatalogHandler(
      () => Promise.resolve({ body: { ok: true } }),
      mockLogger(),
      'Test',
    );
    const result = await handler(
      { params: {}, query: {}, body: {} },
      {} as never,
    );
    expect(result).toEqual({ status: 200, body: { ok: true } });
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
    const result = await handler(
      { params: {}, query: {}, body: {} },
      {} as never,
    );
    expect(result).toEqual({
      status: 200,
      body: { ok: true },
      headers: { 'Cache-Control': 'no-cache' },
    });
  });

  it('maps a thrown RequestError to its code, status and extras', async () => {
    const logger = mockLogger();
    const handler = wrapCatalogHandler(
      () => {
        throw new RequestError('not_found', 'Nope', { message: 'detail' });
      },
      logger,
      'Test',
    );
    const result = await handler(
      { params: {}, query: {}, body: {} },
      {} as never,
    );
    expect(result).toEqual({
      status: 404,
      body: { code: 'not_found', error: 'Nope', message: 'detail' },
    });
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps an unexpected throw to a generic 500, logged but never sent', async () => {
    const logger = mockLogger();
    const handler = wrapCatalogHandler(
      () => {
        throw new Error('/secret/path failed');
      },
      logger,
      'Test',
    );
    const result = await handler(
      { params: {}, query: {}, body: {} },
      {} as never,
    );
    expect(result).toEqual({
      status: 500,
      body: {
        code: 'internal_error',
        error: 'Internal Server Error',
        message: 'Internal server error',
      },
    });
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('/secret/path');
  });
});

describe('catalogErrorFromThrown', () => {
  it('reuses errorResult for a RequestError', () => {
    const logger = mockLogger();
    const result = catalogErrorFromThrown(
      new RequestError('path_not_watched', 'Outside scope'),
      logger,
      'Render',
    );
    expect(result).toEqual({
      status: 403,
      body: { code: 'path_not_watched', error: 'Outside scope' },
    });
  });

  it('logs unexpected errors at error level with a generic body', () => {
    const logger = mockLogger();
    const result = catalogErrorFromThrown(
      new TypeError('boom'),
      logger,
      'Scan',
    );
    expect(result.status).toBe(500);
    expect(result.body['code']).toBe('internal_error');
    expect(logger.error).toHaveBeenCalled();
  });
});
