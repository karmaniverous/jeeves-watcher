/**
 * @module api/errors.test
 * The service's `defineError` classes against core's code table: every class's code and status is in `WATCHER_ERROR_STATUS` and every code there has a class; messages are fixed and capped (`capArg`); `Retry-After` helpers; one pipeline class per issue type; render failures by issue type.
 */

import {
  ISSUE_TYPES,
  WATCHER_ERROR_CODES,
  WATCHER_ERROR_STATUS,
} from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

import * as errors from './errors';

const {
  capArg,
  documentBusy,
  embeddingUnavailable,
  isPipelineIssueType,
  MESSAGE_ARG_MAX,
  PIPELINE_ERRORS,
  pipelineErrorCode,
  renderFailureError,
  vcsBusy,
} = errors;

/** An instance of a `defineError` class, as far as this test cares. */
interface Made {
  code: string;
  statusCode: number;
  message: string;
}

/** Every `defineError` class the module exports, plus the pipeline classes. */
const classes: [string, new (...args: string[]) => Made][] = [
  ...Object.entries(errors).filter(
    ([name, value]) =>
      typeof value === 'function' &&
      /^[A-Z]/.test(name) &&
      typeof (new (value as new () => Made)() as Partial<Made>).code ===
        'string',
  ),
  ...Object.entries(PIPELINE_ERRORS),
] as [string, new (...args: string[]) => Made][];

describe('defineError classes', () => {
  it.each(classes)(
    '%s has a code and status from WATCHER_ERROR_STATUS',
    (_name, Cls) => {
      const made = new Cls('a', 'b');
      expect(WATCHER_ERROR_CODES).toContain(made.code);
      expect(made.statusCode).toBe(
        WATCHER_ERROR_STATUS[made.code as keyof typeof WATCHER_ERROR_STATUS],
      );
    },
  );

  it('covers every code in WATCHER_ERROR_STATUS', () => {
    const covered = new Set(classes.map(([, Cls]) => new Cls('a', 'b').code));
    expect([...covered].sort()).toEqual([...WATCHER_ERROR_CODES].sort());
  });

  it.each(classes)('%s has a non-empty fixed message', (_name, Cls) => {
    expect(new Cls('a', 'b').message.length).toBeGreaterThan(0);
  });
});

describe('capArg', () => {
  it('leaves an argument up to the limit alone', () => {
    const value = 'x'.repeat(MESSAGE_ARG_MAX);
    expect(capArg(value)).toBe(value);
  });

  it('cuts a longer argument to the limit, marking the cut', () => {
    const capped = capArg('x'.repeat(MESSAGE_ARG_MAX + 1));
    expect(capped).toHaveLength(MESSAGE_ARG_MAX);
    expect(capped).toBe(`${'x'.repeat(MESSAGE_ARG_MAX - 1)}…`);
  });

  it('caps at 300 characters (D204 (3), (4))', () => {
    expect(MESSAGE_ARG_MAX).toBe(300);
  });
});

describe('Retry-After helpers', () => {
  it('documentBusy carries Retry-After: 10', () => {
    expect(documentBusy()).toMatchObject({
      code: 'WATCHER_NOT_AVAILABLE',
      statusCode: 503,
      headers: { 'retry-after': '10' },
    });
  });

  it('vcsBusy carries Retry-After: 30', () => {
    expect(vcsBusy()).toMatchObject({
      code: 'WATCHER_NOT_AVAILABLE',
      statusCode: 503,
      headers: { 'retry-after': '30' },
    });
  });

  it.each([
    [0, '1'],
    [1, '1'],
    [1000, '1'],
    [1001, '2'],
    [2500, '3'],
  ])('embeddingUnavailable rounds %ims up to Retry-After %s', (ms, header) => {
    expect(embeddingUnavailable(ms)).toMatchObject({
      code: 'WATCHER_EMBEDDING_UNAVAILABLE',
      statusCode: 503,
      headers: { 'retry-after': header },
    });
  });

  it('embeddingUnavailable without a known delay sends no Retry-After', () => {
    expect(embeddingUnavailable()).not.toHaveProperty('headers');
  });
});

describe('pipeline codes (D203 (2))', () => {
  it.each([
    ['extraction_error', 'WATCHER_PIPELINE_EXTRACTION_ERROR'],
    ['interpolation_error', 'WATCHER_PIPELINE_INTERPOLATION_ERROR'],
    ['match_failed', 'WATCHER_PIPELINE_MATCH_FAILED_ERROR'],
    ['type_collision', 'WATCHER_PIPELINE_TYPE_COLLISION_ERROR'],
    ['too_large', 'WATCHER_PIPELINE_TOO_LARGE_ERROR'],
  ] as const)('%s -> %s', (issue, code) => {
    expect(pipelineErrorCode(issue)).toBe(code);
  });

  it('has one class per issue type except the two with their own code', () => {
    expect(Object.keys(PIPELINE_ERRORS)).toEqual(
      ISSUE_TYPES.filter(
        (t) => t !== 'source_unavailable' && t !== 'unsupported_content_type',
      ),
    );
    expect(isPipelineIssueType('source_unavailable')).toBe(false);
    expect(isPipelineIssueType('unsupported_content_type')).toBe(false);
    expect(isPipelineIssueType('no_content')).toBe(true);
  });
});

describe('renderFailureError', () => {
  it.each([
    ['source_unavailable', 'WATCHER_SOURCE_UNAVAILABLE', 502],
    ['unsupported_content_type', 'WATCHER_UNSUPPORTED_CONTENT_TYPE', 422],
    ['rule_missing', 'WATCHER_PIPELINE_RULE_MISSING_ERROR', 422],
    [undefined, 'WATCHER_PIPELINE_EXTRACTION_ERROR', 422],
  ] as const)('%s -> %s (%i)', (issue, code, statusCode) => {
    expect(renderFailureError(issue)).toMatchObject({ code, statusCode });
  });
});
