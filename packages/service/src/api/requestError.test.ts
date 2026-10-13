/**
 * @module api/requestError.test
 * RequestError carries status, code and extras; Qdrant 400/422 rejections (REST client ApiError shape) map to 400 invalid_request "Invalid filter" with Qdrant's reason, every other error passes through unchanged.
 */

import { describe, expect, it } from 'vitest';

import {
  INVALID_FILTER,
  invalidRequest,
  isQdrantRejection,
  RequestError,
  toFilterError,
  withFilterErrors,
} from './requestError';

/** An error shaped like the Qdrant REST client's `ApiError`. */
const qdrantError = (status: number, data: unknown = {}) =>
  Object.assign(new Error('Bad Request'), { status, data, url: 'u' });

describe('RequestError', () => {
  it('carries status, code, text and extras', () => {
    const err = new RequestError(404, 'not_found', 'gone', { message: 'm' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'gone',
      extras: { message: 'm' },
      name: 'RequestError',
    });
  });

  it('invalidRequest is a 400 invalid_request', () => {
    expect(invalidRequest('bad', { details: [1] })).toMatchObject({
      status: 400,
      code: 'invalid_request',
      message: 'bad',
      extras: { details: [1] },
    });
  });
});

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
  it("maps a rejection to 400 invalid_request with Qdrant's reason", () => {
    const mapped = toFilterError(
      qdrantError(400, { status: { error: 'Format error in JSON body' } }),
    );
    expect(mapped).toBeInstanceOf(RequestError);
    expect(mapped).toMatchObject({
      status: 400,
      code: 'invalid_request',
      message: INVALID_FILTER,
      extras: { message: 'Format error in JSON body' },
    });
  });

  it('omits the reason when Qdrant gives none', () => {
    const mapped = toFilterError(qdrantError(400, 'not json')) as RequestError;
    expect(mapped.extras.message).toBeUndefined();
  });

  it('passes any other error through', () => {
    const other = new Error('connection refused');
    expect(toFilterError(other)).toBe(other);
  });
});

describe('withFilterErrors', () => {
  it('resolves with the operation result', async () => {
    await expect(withFilterErrors(Promise.resolve(3))).resolves.toBe(3);
  });

  it('rejects with the mapped error', async () => {
    await expect(
      withFilterErrors(Promise.reject(qdrantError(422))),
    ).rejects.toBeInstanceOf(RequestError);
  });
});
