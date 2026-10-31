/**
 * @module api/catalog/errorResult.test
 * Behaviour of `errorResult`: status from `API_ERROR_STATUS`, body carries
 * `code` and `error`, and extras are spread verbatim (field names kept,
 * e.g. `issues`).
 */

import { describe, expect, it } from 'vitest';

import { INTERNAL_ERROR_MESSAGE } from '../sendError';
import { errorResult, internalErrorResult, withErrorCode } from './errorResult';

describe('errorResult', () => {
  it('maps a code to its status with no extras', () => {
    expect(errorResult('not_found', 'Not Found')).toEqual({
      status: 404,
      body: { code: 'not_found', error: 'Not Found' },
    });
  });

  it('maps invalid_request to 400', () => {
    expect(errorResult('invalid_request', 'Bad input')).toEqual({
      status: 400,
      body: { code: 'invalid_request', error: 'Bad input' },
    });
  });

  it('maps internal_error to 500', () => {
    expect(errorResult('internal_error', 'Internal Server Error')).toEqual({
      status: 500,
      body: { code: 'internal_error', error: 'Internal Server Error' },
    });
  });

  it('spreads extras verbatim, keeping their field names', () => {
    const issues = [{ path: ['patch'], message: 'patch must be an object' }];
    expect(
      errorResult('invalid_request', 'Config validation failed', { issues }),
    ).toEqual({
      status: 400,
      body: {
        code: 'invalid_request',
        error: 'Config validation failed',
        issues,
      },
    });
  });

  it('spreads message, details and issueType extras', () => {
    expect(
      errorResult('pipeline_error', 'Render failed', {
        message: 'bad bytes',
        details: { reason: 'stub' },
        issueType: 'extraction_error',
      }),
    ).toEqual({
      status: 422,
      body: {
        code: 'pipeline_error',
        error: 'Render failed',
        message: 'bad bytes',
        details: { reason: 'stub' },
        issueType: 'extraction_error',
      },
    });
  });
});

describe('withErrorCode', () => {
  it.each([
    ['a 2xx result', { status: 200, body: { result: [] } }],
    [
      'an error body that has a code',
      { status: 400, body: { code: 'invalid_request', error: 'x' } },
    ],
  ])('returns %s unchanged', (_name, result) => {
    expect(withErrorCode(result)).toBe(result);
  });

  it('adds the code for the status before the body fields', () => {
    expect(
      withErrorCode({ status: 400, body: { error: 'Bad', issues: [1] } }),
    ).toEqual({
      status: 400,
      body: { code: 'invalid_request', error: 'Bad', issues: [1] },
    });
  });

  it('gives a non-object error body just the code', () => {
    expect(withErrorCode({ status: 404, body: null })).toEqual({
      status: 404,
      body: { code: 'not_found' },
    });
  });
});

describe('errorResult extras', () => {
  it('leaves out undefined extras', () => {
    // Keys, not toEqual: toEqual treats an undefined-valued key as absent.
    expect(
      Object.keys(
        errorResult('not_found', 'Missing', { issueType: undefined, path: 'a' })
          .body,
      ),
    ).toEqual(['code', 'error', 'path']);
  });
});

describe('internalErrorResult', () => {
  it('is the generic 500 body', () => {
    expect(internalErrorResult()).toEqual({
      status: 500,
      body: {
        code: 'internal_error',
        error: 'Internal Server Error',
        message: INTERNAL_ERROR_MESSAGE,
      },
    });
  });
});
