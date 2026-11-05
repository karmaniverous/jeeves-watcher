/**
 * @module util/documentKey.test
 * documentKey: source references kept verbatim (case-sensitive), file paths normalised.
 */

import { describe, expect, it } from 'vitest';

import {
  isSourceReference,
  keyWithin,
  normalizeDocumentKey,
} from './documentKey';

describe('documentKey', () => {
  it.each([
    ['app://chat/thread/AbC', true],
    ['support://ticket/1', true],
    ['c:/docs/a.md', false],
    ['C:\\docs\\a.md', false],
    ['c://docs/a.md', false],
    ['/var/data/a.md', false],
  ])('isSourceReference(%s) = %s', (key, expected) => {
    expect(isSourceReference(key)).toBe(expected);
  });

  it('keeps source references verbatim (case-sensitive)', () => {
    expect(normalizeDocumentKey('app://chat/thread/AbC')).toBe(
      'app://chat/thread/AbC',
    );
  });

  it('normalises file paths', () => {
    expect(normalizeDocumentKey('C:\\Docs\\A.md')).toBe('c:/docs/a.md');
  });
});

describe('keyWithin', () => {
  it.each([
    ['c:/a', 'c:/a', true],
    ['c:/a/b/c', 'c:/a', true],
    ['c:/ab', 'c:/a', false],
    ['c:/a', 'c:/a/b', false],
  ])('%s within %s is %s', (key, ancestor, expected) => {
    expect(keyWithin(key, ancestor)).toBe(expected);
  });
});
