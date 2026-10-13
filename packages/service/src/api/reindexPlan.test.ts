/**
 * @module api/reindexPlan.test
 * groupByRoot: files are counted under the first watch root whose glob prefix they start with (slashes normalised), others under "(unmatched)".
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

  it('normalises backslashes in files and roots', () => {
    expect(
      groupByRoot(['C:\\w\\docs\\a.md'], ['C:\\w\\docs\\**\\*.md']),
    ).toEqual({ 'C:/w/docs': 1 });
  });

  it('returns an empty record for no files', () => {
    expect(groupByRoot([], ['/w/**'])).toEqual({});
  });
});
