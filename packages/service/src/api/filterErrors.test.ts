/**
 * @module api/filterErrors.test
 * Qdrant 400/422 rejections (REST client ApiError shape) map to `FilterRejected` (`400 WATCHER_INVALID_REQUEST`) with Qdrant's reason, capped; the Qdrant error is logged at debug; every other error passes through unchanged.
 */

import { describe, expect, it, vi } from 'vitest';

import { FilterRejected, MESSAGE_ARG_MAX } from './errors';
import {
  isQdrantRejection,
  NO_QDRANT_REASON,
  toFilterError,
  withFilterErrors,
} from './filterErrors';

/** An error shaped like the Qdrant REST client's `ApiError`. */
const qdrantError = (status: number, data: unknown = {}) =>
  Object.assign(new Error('Bad Request'), { status, data, url: 'u' });

describe('isQdrantRejection', () => {
  it.each([
    ['a Qdrant 400', qdrantError(400), true],
    ['a Qdrant 422', qdrantError(422), true],
    ['a Qdrant 404', qdrantError(404), false],
    ['a Qdrant 500', qdrantError(500), false],
    ['a plain error', new Error('x'), false],
    [
      'a 400 without response data',
      Object.assign(new Error(), { status: 400 }),
      false,
    ],
    ['a non-error', { status: 400, data: {} }, false],
  ])('%s -> %s', (_label, error, expected) => {
    expect(isQdrantRejection(error)).toBe(expected);
  });
});

describe('toFilterError', () => {
  it("maps a rejection to FilterRejected with Qdrant's reason", () => {
    const mapped = toFilterError(
      qdrantError(400, { status: { error: 'Format error in JSON body' } }),
    );
    expect(mapped).toBeInstanceOf(FilterRejected);
    expect(mapped).toMatchObject({
      statusCode: 400,
      code: 'WATCHER_INVALID_REQUEST',
      message:
        'The vector store rejected the filter: Format error in JSON body',
    });
  });

  it('caps a long reason', () => {
    const mapped = toFilterError(
      qdrantError(400, { status: { error: 'x'.repeat(1000) } }),
    ) as Error;
    const reason = mapped.message.replace(
      'The vector store rejected the filter: ',
      '',
    );
    expect(reason).toHaveLength(MESSAGE_ARG_MAX);
    expect(reason.endsWith('…')).toBe(true);
  });

  it.each([
    ['a non-object body', 'not json'],
    ['a body without status', {}],
    ['a status without error', { status: {} }],
    ['an empty error', { status: { error: '' } }],
  ])('says no reason was given for %s', (_label, data) => {
    expect((toFilterError(qdrantError(422, data)) as Error).message).toBe(
      `The vector store rejected the filter: ${NO_QDRANT_REASON}`,
    );
  });

  it('passes any other error through', () => {
    const other = new Error('connection refused');
    expect(toFilterError(other)).toBe(other);
  });
});

describe('withFilterErrors', () => {
  const logger = () => ({ debug: vi.fn() });

  it('resolves with the operation result', async () => {
    await expect(withFilterErrors(Promise.resolve(3), logger())).resolves.toBe(
      3,
    );
  });

  it('rejects with the mapped error and logs the Qdrant error', async () => {
    const log = logger();
    const rejection = qdrantError(422);
    await expect(
      withFilterErrors(Promise.reject(rejection), log),
    ).rejects.toBeInstanceOf(FilterRejected);
    expect(log.debug).toHaveBeenCalledWith(
      { err: rejection },
      'The vector store rejected a filter',
    );
  });

  it('rethrows any other error unchanged, unlogged', async () => {
    const log = logger();
    const other = new Error('down');
    await expect(withFilterErrors(Promise.reject(other), log)).rejects.toBe(
      other,
    );
    expect(log.debug).not.toHaveBeenCalled();
  });
});
