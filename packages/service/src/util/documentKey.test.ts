import { describe, expect, it } from 'vitest';

import { isSourceReference, normalizeDocumentKey } from './documentKey';

describe('documentKey', () => {
  it.each([
    ['cg://chat/thread/AbC', true],
    ['support://ticket/1', true],
    ['j:/docs/a.md', false],
    ['C:\\docs\\a.md', false],
    ['c://docs/a.md', false],
    ['/var/data/a.md', false],
  ])('isSourceReference(%s) = %s', (key, expected) => {
    expect(isSourceReference(key)).toBe(expected);
  });

  it('keeps source references verbatim (case-sensitive)', () => {
    expect(normalizeDocumentKey('cg://chat/thread/AbC')).toBe(
      'cg://chat/thread/AbC',
    );
  });

  it('normalises file paths', () => {
    expect(normalizeDocumentKey('J:\\Docs\\A.md')).toBe('j:/docs/a.md');
  });
});
