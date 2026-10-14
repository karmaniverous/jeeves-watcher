/**
 * @module api/errors.test
 * Tests for the canonical API error code list, its status table and the error body schema.
 */

import { describe, expect, it } from 'vitest';

import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  apiErrorBodySchema,
  apiErrorCodeSchema,
} from './errors';

describe('apiErrorCodeSchema', () => {
  it('lists the canonical codes in order', () => {
    expect(apiErrorCodeSchema.options).toEqual([...API_ERROR_CODES]);
    expect(API_ERROR_CODES).toEqual([
      'invalid_request',
      'unauthorized',
      'path_not_watched',
      'not_found',
      'source_not_indexed',
      'source_not_found',
      'unsupported_content_type',
      'pipeline_error',
      'source_unavailable',
      'not_available',
      'scan_in_progress',
      'embedding_unavailable',
      'internal_error',
    ]);
  });

  it.each(API_ERROR_CODES)('%s is snake_case', (c) => {
    expect(c).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('assigns each code its documented status', () => {
    expect(API_ERROR_STATUS).toEqual({
      invalid_request: 400,
      unauthorized: 401,
      path_not_watched: 403,
      not_found: 404,
      source_not_indexed: 404,
      source_not_found: 404,
      unsupported_content_type: 422,
      pipeline_error: 422,
      source_unavailable: 502,
      not_available: 503,
      scan_in_progress: 503,
      embedding_unavailable: 503,
      internal_error: 500,
    });
  });

  it('rejects human text', () => {
    expect(apiErrorCodeSchema.safeParse('Unauthorized').success).toBe(false);
  });
});

describe('apiErrorBodySchema', () => {
  it('accepts a minimal body and optional fields', () => {
    expect(
      apiErrorBodySchema.safeParse({ code: 'unauthorized', error: 'x' })
        .success,
    ).toBe(true);
    expect(
      apiErrorBodySchema.safeParse({
        code: 'pipeline_error',
        error: 'boom',
        message: 'more',
        details: [{ x: 1 }],
        issueType: 'match_failed',
      }).success,
    ).toBe(true);
  });

  it.each([
    [{ error: 'Unauthorized' }],
    [{ code: 'Unauthorized', error: 'x' }],
    [{ code: 'not_found' }],
    [{ code: 'pipeline_error', error: 'x', issueType: 'nope' }],
  ])('rejects %j', (body) => {
    expect(apiErrorBodySchema.safeParse(body).success).toBe(false);
  });
});
