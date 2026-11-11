/**
 * @module api/errors.test
 * Tests for the `WATCHER_*` error code list and its status table.
 */

import { describe, expect, it } from 'vitest';

import { WATCHER_ERROR_CODES, WATCHER_ERROR_STATUS } from './errors';
import { ISSUE_TYPES } from './monitoring';

/** Issue types that have their own code rather than a pipeline code. */
const NON_PIPELINE_ISSUE_TYPES = new Set([
  'source_unavailable',
  'unsupported_content_type',
]);

describe('WATCHER_ERROR_CODES', () => {
  it.each(WATCHER_ERROR_CODES)(
    '%s is upper case and WATCHER_-prefixed',
    (c) => {
      expect(c).toMatch(/^WATCHER_[A-Z]+(_[A-Z]+)*$/);
    },
  );

  it('has no duplicates', () => {
    expect(new Set(WATCHER_ERROR_CODES).size).toBe(WATCHER_ERROR_CODES.length);
  });

  it('has one pipeline code per issue type, derived from ISSUE_TYPES', () => {
    const derived = ISSUE_TYPES.filter(
      (type) => !NON_PIPELINE_ISSUE_TYPES.has(type),
    ).map(
      (type) =>
        `WATCHER_PIPELINE_${type.replace(/_error$/, '').toUpperCase()}_ERROR`,
    );
    expect(derived).toHaveLength(9);
    expect(
      WATCHER_ERROR_CODES.filter((c) => c.startsWith('WATCHER_PIPELINE_')),
    ).toEqual(derived);
  });

  it('keeps own codes for the two non-pipeline issue types', () => {
    expect(WATCHER_ERROR_CODES).toContain('WATCHER_SOURCE_UNAVAILABLE');
    expect(WATCHER_ERROR_CODES).toContain('WATCHER_UNSUPPORTED_CONTENT_TYPE');
  });
});

describe('WATCHER_ERROR_STATUS', () => {
  it('has exactly the listed codes', () => {
    expect(Object.keys(WATCHER_ERROR_STATUS)).toEqual([...WATCHER_ERROR_CODES]);
  });

  it('assigns each code its status from the code table', () => {
    const pipeline = Object.fromEntries(
      WATCHER_ERROR_CODES.filter((c) => c.startsWith('WATCHER_PIPELINE_')).map(
        (c) => [c, 422],
      ),
    );
    expect(WATCHER_ERROR_STATUS).toEqual({
      WATCHER_INVALID_REQUEST: 400,
      WATCHER_UNAUTHORIZED: 401,
      WATCHER_PATH_NOT_WATCHED: 403,
      WATCHER_NOT_FOUND: 404,
      WATCHER_SOURCE_NOT_INDEXED: 404,
      WATCHER_SOURCE_NOT_FOUND: 404,
      WATCHER_UNSUPPORTED_CONTENT_TYPE: 422,
      ...pipeline,
      WATCHER_SOURCE_UNAVAILABLE: 502,
      WATCHER_NOT_AVAILABLE: 503,
      WATCHER_SCAN_IN_PROGRESS: 503,
      WATCHER_EMBEDDING_UNAVAILABLE: 503,
    });
  });
});
