/**
 * @module api/reindexPlan.test
 * groupByRoot: files are counted under the first watch root (static prefix before the first glob segment) that contains them (separator-aware, slashes normalised), others under "(unmatched)".
 */

import { describe, expect, it } from 'vitest';

import { groupByRoot } from './reindexPlan';

describe('groupByRoot', () => {
  it('groups by the first matching root prefix', () => {
    expect(
      groupByRoot(
        [
          '/w/docs/a.md',
          '/w/docs/sub/b.md',
          '/w/notes/c.md',
          '/elsewhere/d.md',
        ],
        ['/w/docs/**/*.md', '/w/notes/**', '/w/**'],
      ),
    ).toEqual({ '/w/docs': 2, '/w/notes': 1, '(unmatched)': 1 });
  });

  it('never claims a sibling directory sharing the root prefix', () => {
    expect(
      groupByRoot(['/w/docs2/x.md', '/w/docs/a.md'], ['/w/docs/**']),
    ).toEqual({ '/w/docs': 1, '(unmatched)': 1 });
  });

  it.each([
    ['a single-segment wildcard', '/w/docs/*.md', '/w/docs'],
    ['a brace set', '/w/{docs,notes}/**', '/w'],
    ['a character wildcard', '/w/file?.md', '/w'],
    ['a character class', '/w/docs/[ab].md', '/w/docs'],
  ])('groups under the static prefix of %s', (_label, watch, root) => {
    expect(groupByRoot(['/w/docs/a.md'], [watch])).toEqual({ [root]: 1 });
  });

  it('keeps the sibling rule for a non-** glob prefix', () => {
    expect(
      groupByRoot(['/w/docs2/a.md', '/w/docs/a.md'], ['/w/docs/*.md']),
    ).toEqual({ '/w/docs': 1, '(unmatched)': 1 });
  });

  it('lets a relative glob with no static prefix claim every path', () => {
    expect(groupByRoot(['/w/a.md'], ['**/*.md'])).toEqual({ '': 1 });
  });

  it('normalises backslashes in files and roots', () => {
    expect(
      groupByRoot(['C:\\w\\docs\\a.md'], ['C:\\w\\docs\\**\\*.md']),
    ).toEqual({ 'C:/w/docs': 1 });
  });

  it('returns an empty record for no files', () => {
    expect(groupByRoot([], ['/w/**'])).toEqual({});
  });
});
