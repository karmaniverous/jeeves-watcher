/**
 * @module api/sendError.test
 * Unit tests for the error body builder, sendError, the sources-not-available shortcut, status-to-code mapping and core result passthrough.
 */

import {
  API_ERROR_CODES,
  apiErrorBodySchema,
} from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

import { mockReply } from '../test/vcsHandlers';
import {
  apiErrorBody,
  codeForStatus,
  sendError,
  sendResult,
  sendSourcesNotAvailable,
} from './sendError';

describe('apiErrorBody', () => {
  it('builds { code, error } and omits undefined extras', () => {
    expect(apiErrorBody('not_found', 'File not found')).toEqual({
      code: 'not_found',
      error: 'File not found',
    });
    expect(
      apiErrorBody('invalid_request', 'bad', {
        message: undefined,
        details: undefined,
      }),
    ).toEqual({ code: 'invalid_request', error: 'bad' });
  });

  it('keeps message, details and issueType', () => {
    expect(
      apiErrorBody('pipeline_error', 'boom', {
        message: 'm',
        details: [1],
        issueType: 'match_failed',
      }),
    ).toEqual({
      code: 'pipeline_error',
      error: 'boom',
      message: 'm',
      details: [1],
      issueType: 'match_failed',
    });
  });

  it.each(API_ERROR_CODES)('%s builds a body valid under core', (code) => {
    expect(
      apiErrorBodySchema.safeParse(apiErrorBody(code, 'text')).success,
    ).toBe(true);
  });
});

describe('sendError', () => {
  it('sends status and body and returns the reply', () => {
    const reply = mockReply();
    const returned = sendError(reply, 404, 'not_found', 'gone', {
      message: 'm',
    });
    expect(returned).toBe(reply);
    expect(reply.statusCode).toBe(404);
    expect(reply.body).toEqual({
      code: 'not_found',
      error: 'gone',
      message: 'm',
    });
  });

  it('sendSourcesNotAvailable defaults to 503 and accepts another status', () => {
    const expected = {
      code: 'not_available',
      error: 'Not available',
      message: 'Source documents are not supported by this instance.',
    };
    const a = sendSourcesNotAvailable(mockReply());
    expect(a.statusCode).toBe(503);
    expect(a.body).toEqual(expected);
    const b = sendSourcesNotAvailable(mockReply(), 400);
    expect(b.statusCode).toBe(400);
    expect(b.body).toEqual(expected);
  });
});

describe('codeForStatus', () => {
  it.each([
    [400, 'invalid_request'],
    [401, 'unauthorized'],
    [404, 'not_found'],
    [413, 'invalid_request'],
    [415, 'invalid_request'],
    [500, 'internal_error'],
    [503, 'internal_error'],
  ])('%i -> %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});

describe('sendResult', () => {
  it('adds a code to error bodies and keeps every other field', () => {
    const reply = sendResult(mockReply(), {
      status: 400,
      body: { error: 'Config validation failed', issues: [{ path: ['x'] }] },
    });
    expect(reply.statusCode).toBe(400);
    expect(reply.body).toEqual({
      code: 'invalid_request',
      error: 'Config validation failed',
      issues: [{ path: ['x'] }],
    });
  });

  it('maps 5xx results to internal_error', () => {
    const reply = sendResult(mockReply(), {
      status: 500,
      body: { error: 'Failed to write config' },
    });
    expect(reply.body).toEqual({
      code: 'internal_error',
      error: 'Failed to write config',
    });
  });

  it('leaves an existing code and success bodies alone', () => {
    const coded = sendResult(mockReply(), {
      status: 404,
      body: { code: 'source_not_found', error: 'x' },
    });
    expect(coded.body).toEqual({ code: 'source_not_found', error: 'x' });
    const ok = sendResult(mockReply(), {
      status: 200,
      body: { applied: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toEqual({ applied: true });
  });
});
