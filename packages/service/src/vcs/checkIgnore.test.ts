/**
 * @module vcs/checkIgnore.test
 * Parsing `git check-ignore -v -z` records (D82): rule, source and numeric line; a negated rule is not an exclusion; output that is not a verbose record is an error. Pure.
 */

import { describe, expect, it } from 'vitest';

import { parseCheckIgnore } from './checkIgnore';

describe('parseCheckIgnore', () => {
  it('reads source, line and rule, including colons and spaces', () => {
    expect(
      parseCheckIgnore(
        'sub dir/.gitignore\x0012\x00a:b [x].md\x00sub dir/a:b.md\x00',
      ),
    ).toEqual({
      excluded: true,
      rule: 'a:b [x].md',
      source: 'sub dir/.gitignore',
      line: 12,
    });
  });

  it('treats a negated rule as not excluded', () => {
    expect(
      parseCheckIgnore('.git/info/exclude\x002\x00!/keep.tmp\x00keep.tmp\x00'),
    ).toEqual({ excluded: false });
  });

  it('throws on output that is not a verbose record', () => {
    expect(() => parseCheckIgnore('keep.tmp\x00')).toThrow(
      'Unexpected git check-ignore output',
    );
  });
});
