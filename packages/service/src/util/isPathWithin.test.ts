/**
 * @module util/isPathWithin.test
 * isPathWithin: the root itself and descendants are contained; a sibling sharing the prefix is not; backslashes and trailing slashes are normalised; an empty root contains everything.
 */

import { describe, expect, it } from 'vitest';

import { isPathWithin } from './isPathWithin';

describe('isPathWithin', () => {
  it.each([
    ['/w/docs/a.md', '/w/docs', true],
    ['/w/docs', '/w/docs', true],
    ['/w/docs/sub/b.md', '/w/docs/', true],
    ['C:\\w\\docs\\a.md', 'C:/w/docs', true],
    ['/w/docs2/a.md', '/w/docs', false],
    ['/w/doc', '/w/docs', false],
    ['/anything', '', true],
  ])('%s within %s → %s', (path, root, expected) => {
    expect(isPathWithin(path, root)).toBe(expected);
  });
});
