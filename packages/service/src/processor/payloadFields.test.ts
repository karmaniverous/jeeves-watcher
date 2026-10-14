/**
 * @module processor/payloadFields.test
 * isSourcePoint: a source point carries a non-empty string `source` and no `file_path`; a file point carrying a rule-written `source` is not a source point.
 */

import { describe, expect, it } from 'vitest';

import { isSourcePoint } from './payloadFields';

describe('isSourcePoint', () => {
  it.each([
    [{ source: 'app://a' }, true],
    [{ source: 'app://a', file_path: 'docs/a.md' }, false],
    [{ source: '' }, false],
    [{ source: 7 }, false],
    [{ file_path: 'docs/a.md' }, false],
    [{}, false],
  ])('%j → %s', (payload, expected) => {
    expect(isSourcePoint(payload)).toBe(expected);
  });
});
